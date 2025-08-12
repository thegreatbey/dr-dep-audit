# dep-audit
[![dep-audit logo](dep-audit.png)](https://github.com/thegreatbey/dep-audit)

**dep-audit** is a lightweight CLI tool to check your Node.js project for:
- **Outdated dependencies**
- **Security vulnerabilities** from `npm audit`

It works in local dev and CI/CD pipelines, with pretty colorized output and optional GitHub Actions annotations.

---

## 🚀 Installation

```bash
npm install -g dep-audit
```

Or run without installing:
```bash
npx dep-audit
```

---

## 📦 Usage

### CLI
```bash
dep-audit --severity moderate --exclude lodash,express --gha
```

**Options:**
| Flag               | Description |
|--------------------|-------------|
| `--path <dir>`     | Project path (default: `cwd`) |
| `--severity <lvl>` | Minimum severity to report (`low`, `moderate`, `high`, `critical`) |
| `--exclude <list>` | Comma-separated package names to ignore |
| `--gha`            | Emit GitHub Actions annotations |

### Config file
Place one of these in your project root:
- `dep-audit.json`
- `.dep-auditrc`
- `dep-audit.yml` / `dep-audit.yaml`

Example (`dep-audit.yml`):
```yaml
severity: moderate
exclude:
  - lodash
  - express
```

---

## 🛠 Example Output

```plaintext
Vulnerabilities:
bad-pkg   HIGH      Prototype Pollution
meh-pkg   MODERATE  Some advisory

Dependency status badges:
  Dependencies: https://img.shields.io/badge/dependencies-out_of_date-yellow
  Vulnerabilities: https://img.shields.io/badge/vulnerabilities-high-red
```

---

## 📌 GitHub Actions Example

```yaml
name: dep-audit

on: [push, pull_request]

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run build
      - run: dep-audit --severity moderate --gha
```

---

## ⚙️ Exit Codes
- **0** → OK (no high/critical vulnerabilities found)
- **1** → At least one high/critical vulnerability detected

---

## 📄 License
MIT © cavani21
