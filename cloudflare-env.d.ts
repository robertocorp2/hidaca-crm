declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    FILES: R2Bucket;
    ASSETS: Fetcher;
    INVOICE_IMPORT_PHASE1_ENABLED?: string;
    INVOICE_PRODUCTION_IMPORT_ENABLED?: string;
    ECF_ENABLED?: string;
    ECF_PRODUCTION_ENABLED?: string;
    ECF_GATEWAY_SHARED_SECRET?: string;
    ECF_MASTER_KEY_TEST?: string;
    ECF_MASTER_KEY_CERTIFICATION?: string;
    ECF_MASTER_KEY_PRODUCTION?: string;
    WHATSAPP_ENABLED?: string;
    WHATSAPP_CAMPAIGNS_ENABLED?: string;
    WHATSAPP_ACCESS_TOKEN?: string;
    WHATSAPP_APP_SECRET?: string;
    WHATSAPP_VERIFY_TOKEN?: string;
    WHATSAPP_WABA_ID?: string;
    WHATSAPP_PHONE_NUMBER_ID?: string;
    WHATSAPP_GRAPH_API_VERSION?: string;
    AI_ENABLED?: string;
    VOICE_AI_ENABLED?: string;
    AI_DEFAULT_PROVIDER?: string;
    AI_DEFAULT_MODEL?: string;
    AI_FALLBACK_PROVIDERS?: string;
    AI_GATEWAY_ENABLED?: string;
    AI_OPENAI_MODEL?: string;
    AI_DEEPSEEK_MODEL?: string;
    AI_GEMINI_MODEL?: string;
    OPENAI_API_KEY?: string;
    DEEPSEEK_API_KEY?: string;
    GEMINI_API_KEY?: string;
    CF_AI_GATEWAY_TOKEN?: string;
    CF_ACCOUNT_ID?: string;
    CF_AI_GATEWAY_NAME?: string;
  }
}
