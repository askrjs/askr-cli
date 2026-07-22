declare module "@npmcli/config" {
  export default class Config {
    constructor(options: Record<string, unknown>);
    load(): Promise<void>;
    validate(): boolean;
    readonly flat: Record<string, unknown>;
  }
}

declare module "@npmcli/config/lib/definitions" {
  const value: {
    definitions: Record<string, unknown>;
    flatten: (...args: unknown[]) => unknown;
    shorthands: Record<string, unknown>;
  };
  export default value;
}

declare module "npm-registry-fetch" {
  interface RegistryFetch {
    json(uri: string, options?: Record<string, unknown>): Promise<unknown>;
  }
  const registryFetch: RegistryFetch;
  export default registryFetch;
}
