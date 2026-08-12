#!/usr/bin/env python3
"""Generate sho eigo service introduction video (1920x1080 MP4)."""

from __future__ import annotations

import math
import shutil
import subprocess
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

W, H = 1920, 1080
FPS = 24
OUT_DIR = Path("/tmp/sho-eigo-video")
FRAMES_DIR = OUT_DIR / "frames"
ARTIFACT = Path("/opt/cursor/artifacts/sho-eigo-intro.mp4")
REPO_OUT = Path("/workspace/assets/video/sho-eigo-intro.mp4")
POSTER = Path("/opt/cursor/artifacts/sho-eigo-intro-poster.jpg")
REPO_POSTER = Path("/workspace/assets/video/sho-eigo-intro-poster.jpg")

NAVY = (26, 45, 69)
NAVY_SOFT = (44, 69, 102)
ACCENT = (232, 160, 74)
ACCENT_SOFT = (245, 230, 211)
CREAM = (250, 250, 247)
WHITE = (255, 255, 255)
TEXT = (42, 42, 42)
MUTED = (106, 106, 106)

# WenQuanYi covers both Latin + CJK (DroidSansFallback renders Latin as tofu boxes)
FONT_PATH = "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc"
_FONT_CACHE: dict[int, ImageFont.FreeTypeFont] = {}
_GRAD_CACHE: dict[tuple, Image.Image] = {}


def font(size: int) -> ImageFont.FreeTypeFont:
    if size not in _FONT_CACHE:
        _FONT_CACHE[size] = ImageFont.truetype(FONT_PATH, size)
    return _FONT_CACHE[size]


def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def ease_out(t: float) -> float:
    t = max(0.0, min(1.0, t))
    return 1 - (1 - t) ** 3


def ease_in_out(t: float) -> float:
    t = max(0.0, min(1.0, t))
    return 3 * t * t - 2 * t * t * t


def mix(c1, c2, t: float):
    t = max(0.0, min(1.0, t))
    return tuple(int(lerp(a, b, t)) for a, b in zip(c1, c2))


def draw_text_center(draw, text, y, fnt, fill):
    bbox = draw.textbbox((0, 0), text, font=fnt)
    tw = bbox[2] - bbox[0]
    x = (W - tw) // 2
    draw.text((x, y), text, font=fnt, fill=fill)
    return bbox[3] - bbox[1]


def fade_alpha(progress: float, fade_in=0.15, fade_out=0.15) -> float:
    if progress < fade_in:
        return ease_out(progress / fade_in)
    if progress > 1 - fade_out:
        return ease_out((1 - progress) / fade_out)
    return 1.0


def vertical_gradient(base_top, base_bot, bloom_y=0.35) -> Image.Image:
    key = (base_top, base_bot, bloom_y)
    if key in _GRAD_CACHE:
        return _GRAD_CACHE[key].copy()

    ys = np.linspace(0, 1, H, dtype=np.float32)[:, None, None]  # (H,1,1)
    top = np.array(base_top, dtype=np.float32).reshape(1, 1, 3)
    bot = np.array(base_bot, dtype=np.float32).reshape(1, 1, 3)
    base = top * (1 - ys) + bot * ys  # (H, 1, 3)

    xs = np.linspace(0, 1, W, dtype=np.float32)[None, :, None]  # (1,W,1)
    nx = xs - 0.5
    ny = ys - bloom_y
    bloom = np.exp(-(nx * nx * 3.2 + ny * ny * 5.5)) * 0.18  # (H,W,1)
    boost = np.array([40, 28, 10], dtype=np.float32).reshape(1, 1, 3)
    rgb = np.clip(base + bloom * boost, 0, 255).astype(np.uint8)
    img = Image.fromarray(rgb, "RGB")
    _GRAD_CACHE[key] = img.copy()
    return img


def soft_orb(img: Image.Image, cx: int, cy: int, radius: int, color, alpha=70) -> Image.Image:
    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(overlay)
    for i in range(6, 0, -1):
        r = int(radius * i / 6)
        a = int(alpha * (i / 6) ** 2)
        d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(*color, a))
    return Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB")


def scene_brand(t: float, dur: float) -> Image.Image:
    p = t / dur
    img = vertical_gradient(NAVY, (14, 26, 42))
    img = soft_orb(img, int(W * 0.72), int(H * 0.28), 420, ACCENT, 55)
    img = soft_orb(img, int(W * 0.2), int(H * 0.75), 360, NAVY_SOFT, 90)

    brand_a = ease_out(min(1, p / 0.35))
    tag_a = ease_out(max(0, min(1, (p - 0.25) / 0.35)))
    y_off = int((1 - brand_a) * 40)

    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    bd = ImageDraw.Draw(layer)
    bar_w = int(lerp(0, 120, brand_a))
    if bar_w > 0:
        bd.rounded_rectangle(
            ((W - bar_w) // 2, 390 + y_off, (W + bar_w) // 2, 398 + y_off),
            radius=4,
            fill=(*mix(NAVY, ACCENT, brand_a), int(255 * brand_a)),
        )
    draw_text_center(bd, "sho eigo", 430 + y_off, font(96), (*WHITE, int(255 * brand_a)))
    draw_text_center(bd, "英語の音を、体に入れる。", 560 + y_off // 2, font(42), (*ACCENT_SOFT, int(255 * tag_a)))
    return Image.alpha_composite(img.convert("RGBA"), layer).convert("RGB")


def scene_problem(t: float, dur: float) -> Image.Image:
    p = t / dur
    img = vertical_gradient(CREAM, (236, 233, 224), bloom_y=0.25)
    img = soft_orb(img, 300, 200, 280, ACCENT_SOFT, 120)
    a = fade_alpha(p, 0.12, 0.18)

    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    draw_text_center(ld, "こんな経験、ありませんか", 220, font(36), (*MUTED, int(230 * a)))

    lines = [
        "知っている単語なのに、聴き取れない",
        "教材を続けても、伸びている実感がない",
        "もっと単語を覚えなきゃ…でも聴こえない",
    ]
    for i, line in enumerate(lines):
        appear = ease_out(max(0, min(1, (p - 0.18 - i * 0.14) / 0.2)))
        y = 340 + i * 110
        box_a = int(180 * appear * a)
        ld.rounded_rectangle((360, y - 18, 1560, y + 70), radius=18, fill=(255, 255, 255, box_a))
        ld.text((420, y), f"{i + 1}", font=font(36), fill=(*ACCENT, int(255 * appear * a)))
        ld.text((490, y + 4), line, font=font(40), fill=(*TEXT, int(255 * appear * a)))

    return Image.alpha_composite(img.convert("RGBA"), layer).convert("RGB")


def scene_insight(t: float, dur: float) -> Image.Image:
    p = t / dur
    img = vertical_gradient(NAVY, (20, 34, 54))
    img = soft_orb(img, W // 2, H // 2, 500, ACCENT, 40)
    a = fade_alpha(p)
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    draw_text_center(ld, "原因は、単語力ではありません。", 360, font(44), (*ACCENT_SOFT, int(255 * a)))
    reveal = ease_out(max(0, min(1, (p - 0.28) / 0.3)))
    draw_text_center(ld, "「音の設定」がずれているだけ。", 470, font(56), (*WHITE, int(255 * reveal * a)))
    draw_text_center(
        ld,
        "正しい音を体に入れれば、知っている単語がやっと聴こえる。",
        600,
        font(32),
        (*mix(WHITE, ACCENT_SOFT, 0.4), int(220 * reveal * a)),
    )
    return Image.alpha_composite(img.convert("RGBA"), layer).convert("RGB")


def scene_example(t: float, dur: float) -> Image.Image:
    p = t / dur
    img = vertical_gradient(CREAM, (242, 238, 228), bloom_y=0.3)
    a = fade_alpha(p, 0.1, 0.15)
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    draw_text_center(ld, "たとえば、water。", 180, font(40), (*MUTED, int(240 * a)))

    before_a = ease_out(max(0, min(1, (p - 0.1) / 0.25)))
    after_a = ease_out(max(0, min(1, (p - 0.42) / 0.25)))
    arr = ease_out(max(0, min(1, (p - 0.32) / 0.2)))
    tip = ease_out(max(0, min(1, (p - 0.7) / 0.2)))

    def draw_card(x, y, title, word, note, alpha):
        ld.rounded_rectangle((x, y, x + 520, y + 360), radius=28, fill=(255, 255, 255, int(230 * alpha)))
        ld.text((x + 40, y + 40), title, font=font(28), fill=(*MUTED, int(255 * alpha)))
        ld.text((x + 40, y + 120), word, font=font(64), fill=(*NAVY, int(255 * alpha)))
        ld.text((x + 40, y + 240), note, font=font(30), fill=(*TEXT, int(230 * alpha)))

    draw_card(280, 300, "カタカナ英語", "ウォーター", "頭で覚えている音", before_a * a)
    ld.text((910, 440), "→", font=font(72), fill=(*ACCENT, int(255 * arr * a)))
    draw_card(1080, 300, "本物の音", "ワラ", "Flap T が起きている", after_a * a)
    draw_text_center(ld, "音の現象から学ぶと、景色が変わる。", 760, font(34), (*NAVY, int(255 * tip * a)))
    return Image.alpha_composite(img.convert("RGBA"), layer).convert("RGB")


def scene_value(t: float, dur: float) -> Image.Image:
    p = t / dur
    img = vertical_gradient(NAVY, (16, 28, 46))
    img = soft_orb(img, int(W * 0.8), 200, 380, ACCENT, 50)
    a = fade_alpha(p)
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    draw_text_center(ld, "英語が伸びるだけで、終わらない。", 260, font(44), (*WHITE, int(255 * a)))
    reveal = ease_out(max(0, min(1, (p - 0.25) / 0.35)))
    draw_text_center(ld, "子どもの今の声を、", 400, font(56), (*ACCENT_SOFT, int(255 * reveal * a)))
    draw_text_center(ld, "家族の宝物として残す。", 490, font(56), (*ACCENT, int(255 * reveal * a)))
    sub = ease_out(max(0, min(1, (p - 0.55) / 0.25)))
    draw_text_center(
        ld,
        "毎日のレッスン × 声の記録 × 親の見守り",
        650,
        font(32),
        (*mix(WHITE, ACCENT_SOFT, 0.3), int(230 * sub * a)),
    )
    return Image.alpha_composite(img.convert("RGBA"), layer).convert("RGB")


def scene_features(t: float, dur: float) -> Image.Image:
    p = t / dur
    img = vertical_gradient(CREAM, (238, 234, 224), bloom_y=0.25)
    a = fade_alpha(p, 0.1, 0.15)
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    draw_text_center(ld, "sho eigo でできること", 150, font(40), (*NAVY, int(255 * a)))

    features = [
        ("毎日の専用レッスン", "1日15〜20分。音から体に入れる"),
        ("AI発音採点", "声を出して、その場でフィードバック"),
        ("声の本棚", "ビフォー・アフターが成長の記録に"),
        ("親の見守り", "日次進捗と週次レポートで安心"),
    ]
    for i, (title, desc) in enumerate(features):
        appear = ease_out(max(0, min(1, (p - 0.12 - i * 0.12) / 0.22)))
        col = i % 2
        row = i // 2
        x = 220 + col * 760
        y = 280 + row * 280
        ld.rounded_rectangle((x, y, x + 680, y + 220), radius=24, fill=(255, 255, 255, int(235 * appear * a)))
        ld.rounded_rectangle((x + 36, y + 40, x + 52, y + 180), radius=6, fill=(*ACCENT, int(255 * appear * a)))
        ld.text((x + 80, y + 55), title, font=font(36), fill=(*NAVY, int(255 * appear * a)))
        ld.text((x + 80, y + 120), desc, font=font(28), fill=(*MUTED, int(255 * appear * a)))
    return Image.alpha_composite(img.convert("RGBA"), layer).convert("RGB")


def scene_cta(t: float, dur: float) -> Image.Image:
    p = t / dur
    img = vertical_gradient(NAVY, (12, 22, 38))
    img = soft_orb(img, W // 2, int(H * 0.4), 520, ACCENT, 55)
    a = fade_alpha(p, 0.12, 0.2)
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    draw_text_center(ld, "まずは、音の景色が変わる体験を。", 280, font(40), (*ACCENT_SOFT, int(255 * a)))
    btn = ease_out(max(0, min(1, (p - 0.2) / 0.3)))
    bw, bh = 620, 96
    bx, by = (W - bw) // 2, 420
    ld.rounded_rectangle((bx, by, bx + bw, by + bh), radius=48, fill=(*ACCENT, int(255 * btn * a)))
    draw_text_center(ld, "2日間 無料体験", by + 22, font(44), (*NAVY, int(255 * btn * a)))
    url = ease_out(max(0, min(1, (p - 0.45) / 0.25)))
    draw_text_center(ld, "sho-blog.com", 560, font(36), (*WHITE, int(240 * url * a)))
    draw_text_center(ld, "LINEで「体験」と送るだけ", 640, font(28), (*mix(WHITE, MUTED, 0.2), int(220 * url * a)))
    brand = ease_out(max(0, min(1, (p - 0.65) / 0.2)))
    draw_text_center(ld, "sho eigo", 820, font(32), (*ACCENT, int(255 * brand * a)))
    return Image.alpha_composite(img.convert("RGBA"), layer).convert("RGB")


SCENES = [
    ("brand", 4.0, scene_brand),
    ("problem", 6.0, scene_problem),
    ("insight", 5.5, scene_insight),
    ("example", 7.0, scene_example),
    ("value", 6.0, scene_value),
    ("features", 7.5, scene_features),
    ("cta", 6.0, scene_cta),
]


def crossfade(a: Image.Image, b: Image.Image, t: float) -> Image.Image:
    return Image.blend(a, b, ease_in_out(t))


def render_frames():
    if FRAMES_DIR.exists():
        shutil.rmtree(FRAMES_DIR)
    FRAMES_DIR.mkdir(parents=True, exist_ok=True)
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    total_dur = sum(s[1] for s in SCENES)
    fade = 0.4
    timeline = []
    t0 = 0.0
    for name, dur, fn in SCENES:
        timeline.append((t0, t0 + dur, name, dur, fn))
        t0 += dur
    total_frames = int(total_dur * FPS)

    print(f"Rendering {total_frames} frames ({total_dur:.1f}s @ {FPS}fps)", flush=True)
    for fi in range(total_frames):
        t = fi / FPS
        scene_idx = 0
        for i, (start, end, name, dur, fn) in enumerate(timeline):
            if start <= t < end or i == len(timeline) - 1:
                scene_idx = i
                break
        start, end, name, dur, fn = timeline[scene_idx]
        local_t = min(dur - 1e-6, max(0.0, t - start))
        frame = fn(local_t, dur)

        if scene_idx < len(timeline) - 1 and (end - t) < fade:
            _ns, _ne, _nn, ndur, nfn = timeline[scene_idx + 1]
            next_frame = nfn(0.0, ndur)
            blend_t = 1 - (end - t) / fade
            frame = crossfade(frame, next_frame, blend_t)

        # JPEG frames are much faster to write and still encode cleanly
        path = FRAMES_DIR / f"frame_{fi:05d}.jpg"
        frame.save(path, "JPEG", quality=92, optimize=False)
        if fi % 48 == 0:
            print(f"  frame {fi}/{total_frames}", flush=True)

    poster_t = timeline[4][0] + 2.0
    poster_fi = min(total_frames - 1, int(poster_t * FPS))
    shutil.copy(FRAMES_DIR / f"frame_{poster_fi:05d}.jpg", OUT_DIR / "poster.jpg")
    return total_dur, total_frames


def make_audio(duration: float) -> Path:
    audio = OUT_DIR / "bed.wav"
    cmd = [
        "ffmpeg", "-y",
        "-f", "lavfi", "-i", f"sine=frequency=196:duration={duration}",
        "-f", "lavfi", "-i", f"sine=frequency=246.94:duration={duration}",
        "-f", "lavfi", "-i", f"sine=frequency=293.66:duration={duration}",
        "-f", "lavfi", "-i", f"sine=frequency=392:duration={duration}",
        "-filter_complex",
        (
            "[0]volume=0.035[a0];"
            "[1]volume=0.028,afade=t=in:st=0:d=2,afade=t=out:st={d}:d=2[a1];"
            "[2]volume=0.022,afade=t=in:st=4:d=2[a2];"
            "[3]volume=0.018,afade=t=in:st=8:d=3[a3];"
            "[a0][a1][a2][a3]amix=inputs=4:duration=longest:dropout_transition=2,"
            "afade=t=in:st=0:d=1.5,afade=t=out:st={dout}:d=2.5,"
            "lowpass=f=1800,highpass=f=80"
        ).format(d=max(0.1, duration - 2), dout=max(0.1, duration - 2.5)),
        "-ar", "44100", "-ac", "2",
        str(audio),
    ]
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return audio


def encode_video(duration: float):
    ARTIFACT.parent.mkdir(parents=True, exist_ok=True)
    REPO_OUT.parent.mkdir(parents=True, exist_ok=True)
    audio = make_audio(duration)
    tmp = OUT_DIR / "intro.mp4"
    cmd = [
        "ffmpeg", "-y",
        "-framerate", str(FPS),
        "-i", str(FRAMES_DIR / "frame_%05d.jpg"),
        "-i", str(audio),
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-preset", "medium",
        "-crf", "20",
        "-c:a", "aac",
        "-b:a", "160k",
        "-shortest",
        "-movflags", "+faststart",
        str(tmp),
    ]
    subprocess.run(cmd, check=True)
    shutil.copy(tmp, ARTIFACT)
    shutil.copy(tmp, REPO_OUT)

    img = Image.open(OUT_DIR / "poster.jpg").convert("RGB")
    img.save(POSTER, "JPEG", quality=90)
    img.save(REPO_POSTER, "JPEG", quality=90)

    Path("/workspace/assets/video/README.md").write_text(
        """# sho eigo サービス紹介動画

- `sho-eigo-intro.mp4` — 約 42 秒 / 1920×1080 / H.264
- `sho-eigo-intro-poster.jpg` — サムネイル

## 構成
1. ブランド（sho eigo / 英語の音を、体に入れる。）
2. 課題（聴き取れない・伸びない実感）
3. 洞察（原因は音の設定）
4. 具体例（water → ワラ）
5. 価値（子どもの声を家族の宝物に）
6. 機能（レッスン / AI採点 / 声の本棚 / 見守り）
7. CTA（2日間無料体験 / sho-blog.com）

再生成: `python3 scripts/generate_intro_video.py`
""",
        encoding="utf-8",
    )
    print(f"Wrote {ARTIFACT}")
    print(f"Wrote {REPO_OUT}")


def main():
    duration, _frames = render_frames()
    encode_video(duration)
    subprocess.run(["ffprobe", "-hide_banner", str(ARTIFACT)])


if __name__ == "__main__":
    main()
