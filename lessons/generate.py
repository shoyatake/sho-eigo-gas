#!/usr/bin/env python3
"""sho eigo 900-lesson batch HTML generator.

Inputs:  template.html  +  manifest.json  +  data/lessons.csv
Output:  output/<course_folder>/day<NN>.html (zero-padded)

The template must contain the placeholder `/* __DATA_JSON__ */`; it is
replaced with the per-lesson DATA object as a JSON literal, so the result
is a valid <script>const DATA = {...};</script> block.
"""
import csv
import json
import sys
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
TEMPLATE_PATH = BASE_DIR / "template.html"
MANIFEST_PATH = BASE_DIR / "manifest.json"
LESSONS_CSV = BASE_DIR / "data" / "lessons.csv"
OUTPUT_DIR = BASE_DIR / "output"
LOG_PATH = BASE_DIR / "logs" / "generate.log"

PLACEHOLDER = "/* __DATA_JSON__ */"


def load_template() -> str:
    if not TEMPLATE_PATH.exists():
        sys.exit(f"template.html not found at {TEMPLATE_PATH}")
    tpl = TEMPLATE_PATH.read_text(encoding="utf-8")
    if PLACEHOLDER not in tpl:
        sys.exit(f"template.html is missing placeholder {PLACEHOLDER}")
    return tpl


def load_manifest() -> dict:
    return json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))


def load_lessons() -> list[dict]:
    with LESSONS_CSV.open(encoding="utf-8") as f:
        return list(csv.DictReader(f))


def build_data_object(row: dict, course: dict) -> dict:
    return {
        "lesson_id": row["lesson_id"],
        "course_id": course["id"],
        "course_name": course["name"],
        "day_number": int(row["day_number"]),
        "total_days": course["days"],
        "level": course["level"],
        "title": row["title"],
        "passage_en": row["passage_en"],
        "passage_ja": row["passage_ja"],
        "sentences": json.loads(row["sentences_json"]),
        "vocab": json.loads(row["vocab_json"]),
        "audio_full_en": row["audio_full_en"],
        "audio_intro_jp": row["audio_intro_jp"],
        "en_voice_id": course["en_voice_id"],
    }


def main() -> int:
    tpl = load_template()
    manifest = load_manifest()
    lessons = load_lessons()
    course_by_id = {c["id"]: c for c in manifest["courses"]}

    OUTPUT_DIR.mkdir(exist_ok=True)
    LOG_PATH.parent.mkdir(exist_ok=True)

    generated = 0
    skipped = 0
    errors: list[tuple[str, str]] = []

    with LOG_PATH.open("w", encoding="utf-8") as logf:
        for row in lessons:
            course_id = row.get("course_id")
            course = course_by_id.get(course_id)
            if not course:
                skipped += 1
                logf.write(f"SKIP (course not found): {row.get('lesson_id')}\n")
                continue
            if not course.get("ready", False):
                skipped += 1
                logf.write(f"SKIP (course not ready): {row.get('lesson_id')}\n")
                continue

            try:
                data = build_data_object(row, course)
                json_str = json.dumps(data, ensure_ascii=False, indent=2)
                html = tpl.replace(PLACEHOLDER, json_str)

                folder = OUTPUT_DIR / course["folder"]
                folder.mkdir(exist_ok=True)
                day_num = int(row["day_number"])
                out_path = folder / f"day{day_num:02d}.html"
                out_path.write_text(html, encoding="utf-8")

                generated += 1
                logf.write(f"OK: {course['folder']}/{out_path.name}\n")
            except Exception as e:  # noqa: BLE001
                errors.append((row.get("lesson_id", "?"), str(e)))
                logf.write(f"ERR: {row.get('lesson_id')} - {e}\n")

    print(f"generated: {generated}")
    print(f"skipped:   {skipped}")
    print(f"errors:    {len(errors)}")
    for lid, msg in errors[:10]:
        print(f"  - {lid}: {msg}")

    expected = sum(c["days"] for c in manifest["courses"] if c.get("ready", False))
    if generated != expected:
        print(f"expected {expected} (sum of ready courses) but generated {generated}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
