export class StateKV {
  private sdk: any;

  constructor(sdk: any) {
    this.sdk = sdk;
  }

  async get<T>(scope: string, key: string): Promise<T | null> {
    return this.sdk.trigger("state::get", { scope, key });
  }

  async set<T>(scope: string, key: string, data: T): Promise<T> {
    return this.sdk.trigger("state::set", { scope, key, value: data });
  }

  async delete(scope: string, key: string): Promise<void> {
    return this.sdk.trigger("state::delete", { scope, key });
  }

  async list<T>(scope: string): Promise<T[]> {
    return this.sdk.trigger("state::list", { scope });
  }
}
