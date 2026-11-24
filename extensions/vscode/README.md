# SKLand Wiki XML

Local completion, hover, diagnostics, formatting and document navigation for SKLand Wiki XML. The extension starts the bundled language server automatically for files ending in `.skland.xml`.

For a plain `.xml` file, select **SKLand Wiki XML** as the language mode, or add a narrow pattern to VS Code's `files.associations` setting.

```json
{
  "files.associations": {
    "**/wiki-data/*.xml": "skland-xml"
  }
}
```

The extension analyzes the open document on your device using the shipped SKLand Wiki v1 schema. The desktop extension uses its Extension Host runtime and a bundled stdio server.
