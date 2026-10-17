import type { CimdClientConfig, OAuthClientConfig } from "./types.ts";

export type CimdConfigErrorCode =
  | "cimd_config_conflict"
  | "cimd_registration_missing"
  | "cimd_method_invalid"
  | "cimd_url_invalid"
  | "cimd_port_unfixed"
  | "cimd_redirect_mismatch"
  | "cimd_name_missing"
  | "cimd_reserved_metadata_key";

export type OAuthClientMode = "static" | "client_id_metadata";

export class CimdConfigError extends Error {
  constructor(
    public readonly code: CimdConfigErrorCode,
    message: string,
    public readonly context: Record<string, unknown>,
    public readonly recovery: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "CimdConfigError";
  }
}

export interface ClientIdMetadataDocument {
  client_id: string;
  client_name: string;
  redirect_uris: string[];
  grant_types: ["authorization_code", "refresh_token"];
  response_types: ["code"];
  token_endpoint_auth_method: "none";
  /** RFC 7591 application type. Always "native" for loopback CLI/desktop clients. */
  application_type: "native" | "web";
  scope?: string;
  client_uri?: string;
  logo_uri?: string;
  contacts?: string[];
  [key: string]: unknown;
}

export function isCimdConfig(
  config: OAuthClientConfig,
): config is CimdClientConfig {
  return config.clientRegistration?.method === "client_id_metadata";
}

export function resolveClientMode(config: OAuthClientConfig): OAuthClientMode {
  const raw = config as unknown as Record<string, unknown>;
  const hasClientId = raw.clientId !== undefined;
  const hasClientRegistration = raw.clientRegistration !== undefined;

  if (hasClientId && hasClientRegistration) {
    throw new CimdConfigError(
      "cimd_config_conflict",
      "OAuth client config cannot include both clientId and clientRegistration",
      { hasClientId: true, hasClientRegistration: true },
      "Choose either static clientId mode or client_id_metadata mode.",
    );
  }

  if (hasClientRegistration) {
    const registration = raw.clientRegistration;
    if (
      registration === null || typeof registration !== "object" ||
      Array.isArray(registration)
    ) {
      throw new CimdConfigError(
        "cimd_registration_missing",
        "clientRegistration must be an object with a registration method",
        { clientRegistration: registration },
        'Provide clientRegistration.method = "client_id_metadata".',
      );
    }
    const method = (registration as Record<string, unknown>).method;
    if (method === undefined) {
      throw new CimdConfigError(
        "cimd_registration_missing",
        "clientRegistration.method is required",
        { method },
        'Provide clientRegistration.method = "client_id_metadata".',
      );
    }
    if (method !== "client_id_metadata") {
      throw new CimdConfigError(
        "cimd_method_invalid",
        'Unsupported clientRegistration.method; expected "client_id_metadata"',
        { method },
        'Set clientRegistration.method to "client_id_metadata".',
      );
    }
    return "client_id_metadata";
  }

  if (typeof raw.clientId !== "string") {
    throw new CimdConfigError(
      "cimd_registration_missing",
      "OAuth client config requires either clientId or clientRegistration",
      { hasClientId: false, hasClientRegistration: false },
      "Provide clientId for static mode or clientRegistration for CIMD mode.",
    );
  }

  return "static";
}

export function buildClientIdMetadataDocument(
  config: CimdClientConfig,
): ClientIdMetadataDocument {
  validateCimdClientConfig(config);

  const { clientRegistration } = config;
  const document = {
    ...clientRegistration.metadata?.extra,
    client_uri: clientRegistration.metadata?.client_uri,
    logo_uri: clientRegistration.metadata?.logo_uri,
    contacts: clientRegistration.metadata?.contacts,
    client_id: clientRegistration.clientIdMetadataUrl,
    client_name: config.clientName!,
    redirect_uris: [clientRegistration.redirectUri],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    application_type: "native",
  } as ClientIdMetadataDocument;

  if (config.scopes?.length) {
    document.scope = config.scopes.join(" ");
  }
  for (const key of ["client_uri", "logo_uri", "contacts"] as const) {
    if (document[key] === undefined) {
      delete document[key];
    }
  }

  return document;
}

export function validateCimdClientConfig(
  config: OAuthClientConfig,
): asserts config is CimdClientConfig {
  const mode = resolveClientMode(config);
  if (mode !== "client_id_metadata") {
    throw new CimdConfigError(
      "cimd_registration_missing",
      "CIMD config requires clientRegistration",
      { mode },
      'Provide clientRegistration.method = "client_id_metadata".',
    );
  }

  const raw = config as unknown as Record<string, unknown>;
  const registration = raw.clientRegistration as Record<string, unknown>;
  const metadataUrl = registration.clientIdMetadataUrl;
  try {
    if (typeof metadataUrl !== "string") {
      throw new Error("expected string");
    }
    const parsed = new URL(metadataUrl);
    if (parsed.protocol !== "https:") {
      throw new Error("expected https scheme");
    }
  } catch (cause) {
    throw new CimdConfigError(
      "cimd_url_invalid",
      "clientIdMetadataUrl must be an absolute HTTPS URL",
      { clientIdMetadataUrl: metadataUrl },
      "Provide an absolute https:// URL for clientRegistration.clientIdMetadataUrl.",
      { cause },
    );
  }
  if (
    typeof raw.callbackPort !== "number" || raw.callbackPort === 0 ||
    !Number.isFinite(raw.callbackPort)
  ) {
    throw new CimdConfigError(
      "cimd_port_unfixed",
      "CIMD mode requires a fixed callbackPort",
      { callbackPort: raw.callbackPort },
      "Set callbackPort to a fixed non-zero port and publish the same port in redirectUri.",
    );
  }
  if (
    typeof raw.clientName !== "string" || raw.clientName.trim().length === 0
  ) {
    throw new CimdConfigError(
      "cimd_name_missing",
      "CIMD mode requires an explicit clientName",
      { clientName: raw.clientName },
      "Set clientName to the user-facing application name for the metadata document.",
    );
  }
  const redirectUri = registration.redirectUri;
  try {
    if (typeof redirectUri !== "string") {
      throw new Error("expected string");
    }
    const parsedRedirect = new URL(redirectUri);
    if (parsedRedirect.protocol !== "http:") {
      throw new Error("redirect scheme must be http");
    }
    if (parsedRedirect.hostname !== "127.0.0.1") {
      throw new Error("redirect host must be 127.0.0.1");
    }
    if (parsedRedirect.pathname !== "/callback") {
      throw new Error("redirect path must be /callback");
    }
    if (parsedRedirect.port !== String(raw.callbackPort)) {
      throw new Error("redirect port differs from callbackPort");
    }
  } catch (cause) {
    throw new CimdConfigError(
      "cimd_redirect_mismatch",
      "redirectUri must match the fixed callbackPort",
      { redirectUri, callbackPort: raw.callbackPort },
      "Set clientRegistration.redirectUri to the exact loopback callback URL that will be used at runtime.",
      { cause },
    );
  }
  validateExtraMetadataKeys(registration.metadata);
}

const RESERVED_METADATA_KEYS = new Set([
  "scope",
  "client_id",
  "client_name",
  "client_uri",
  "logo_uri",
  "contacts",
  "redirect_uris",
  "grant_types",
  "response_types",
  "token_endpoint_auth_method",
  "application_type",
]);

function validateExtraMetadataKeys(metadata: unknown): void {
  if (metadata === null || typeof metadata !== "object") {
    return;
  }
  const extra = (metadata as { extra?: unknown }).extra;
  if (extra === undefined) {
    return;
  }
  if (extra === null || typeof extra !== "object" || Array.isArray(extra)) {
    return;
  }
  for (const key of Object.keys(extra)) {
    if (RESERVED_METADATA_KEYS.has(key)) {
      throw new CimdConfigError(
        "cimd_reserved_metadata_key",
        "clientRegistration.metadata.extra cannot contain reserved metadata keys",
        { key },
        "Move reserved OAuth client metadata fields to their dedicated config fields.",
      );
    }
  }
}
