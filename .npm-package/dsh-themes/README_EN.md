# dsh-themes

English | [中文](README.md)

A look & theme plugin for DSH (DeepSeek Harness).

## Install

```bash
dsh plugin --profile web add dsh-themes
```

Restart dsh web, then use it under **Settings → Themes**.

## Features

- Built-in palettes (DSH Default / t3 chat / Grove / Ocean / Ember / Iris) with independent light/dark owners; unspecified sides fall back to the default theme
- One-click Open VSX search & import; VS Code extension / URL / paste-JSON import
- Color editor: light/dark tabs, grouped token pickers + hex inputs with instant effect, rename and reset support
- Persisted theme library (`~/.dsh/dsh-themes.json`)

## Development

Source: https://github.com/MangMax/dsh-themes

```bash
bash scripts/install.sh    # build + assemble + install
```
