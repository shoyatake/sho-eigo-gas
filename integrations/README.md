# Sho Real Data Integrations

## 追加されるもの

1. Sho Search Console Report
2. Sho GA4 Report
3. Sho Projects Auto Add

## 必要なGitHub Secrets

### GOOGLE_SERVICE_ACCOUNT_JSON
Google CloudのサービスアカウントJSON全体を貼る。

Search ConsoleとGA4の両方で使う。

### GH_PROJECT_TOKEN
GitHub Projects v2へIssueを追加するためのPAT。

Fine-grained PATなら対象repoとProjects権限を付ける。

## 必要なGitHub Variables

### GSC_SITE_URL
例:

https://sho-blog.com/

### GA4_PROPERTY_ID
GA4のプロパティID。数字だけ。

### PROJECT_ID
GitHub Projects v2のNode ID。

例:

PVT_xxxxxxxxx

## Google側で必要なこと

### Search Console
サービスアカウントのメールアドレスをSearch Consoleプロパティに追加する。

### GA4
GA4プロパティのアクセス管理で、サービスアカウントのメールアドレスを閲覧者以上で追加する。

## 実行

Actionsから手動実行:

- Sho Search Console Report
- Sho GA4 Report
- Sho Projects Auto Add
