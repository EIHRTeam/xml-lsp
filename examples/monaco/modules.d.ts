declare module 'monaco-editor/editor/editor.api.js' {
  export * from 'monaco-editor'
}

declare module 'monaco-editor/languages/definitions/xml/xml.js' {
  export const conf: import('monaco-editor').languages.LanguageConfiguration
  export const language: import('monaco-editor').languages.IMonarchLanguage
}

declare module '*.css'
