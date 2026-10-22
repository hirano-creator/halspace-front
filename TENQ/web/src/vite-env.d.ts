/// <reference types="vite/client" />
interface ImportMetaEnv { readonly VITE_TENQ_API?: string; readonly VITE_DEV_LOGIN?: string }
interface ImportMeta { readonly env: ImportMetaEnv }
