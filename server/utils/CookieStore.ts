import { H3Event, parseCookies, getRequestHeader } from 'h3';
import { CookieKVValue, getMpCookie, setMpCookie, deleteMpCookie, updateRefreshTime } from '~/server/kv/cookie';

export type CookieEntity = Record<string, string | number>;

// 微信实际4天过期，我们3.5天（84小时）时自动刷新
const WX_EXPIRE_HOURS = 84; 
const WX_EXPIRE_MS = WX_EXPIRE_HOURS * 60 * 60 * 1000;

export class AccountCookie {
  private readonly _token: string;
  private _cookie: CookieEntity[];
  private readonly _createdAt: number;
  private _refreshedAt: number;

  constructor(token: string, cookies: string[], createdAt?: number, refreshedAt?: number) {
    this._token = token;
    this._cookie = AccountCookie.parse(cookies);
    this._createdAt = createdAt || Date.now();
    this._refreshedAt = refreshedAt || this._createdAt;
  }

  static create(token: string, cookies: CookieEntity[], createdAt?: number, refreshedAt?: number): AccountCookie {
    const cookieStrings = cookies.map(c => 
      `${c.name}=${c.value}; expires=${new Date(c.expires_timestamp as number).toUTCString()}`
    );
    const value = new AccountCookie(token, cookieStrings, createdAt, refreshedAt);
    value._cookie = cookies;
    return value;
  }

  public toString(): string {
    return this.stringify(this._cookie);
  }

  public toJSON(): CookieKVValue {
    return {
      token: this._token,
      cookies: this._cookie,
      createdAt: this._createdAt,
      refreshedAt: this._refreshedAt,
    };
  }

  public get(name: string): CookieEntity | undefined {
    return this._cookie.find(cookie => cookie.name === name);
  }

  public get token() {
    return this._token;
  }

  public get createdAt() {
    return this._createdAt;
  }

  public get refreshedAt() {
    return this._refreshedAt;
  }

  // 是否需要刷新（3.5天时返回true）
  public get needsRefresh(): boolean {
    const now = Date.now();
    const timeSinceRefresh = now - this._refreshedAt;
    return timeSinceRefresh > (WX_EXPIRE_MS - 12 * 60 * 60 * 1000); // 到期前12小时刷新
  }

  // 是否已过期（4天）
  public get isExpired(): boolean {
    const now = Date.now();
    return (now - this._refreshedAt) > WX_EXPIRE_MS;
  }

  public static parse(cookies: string[]): CookieEntity[] {
    const cookieMap = new Map<string, CookieEntity>();

    for (const cookie of cookies) {
      const cookieObj: CookieEntity = {};
      const parts = cookie.split(';').map(str => str.trim());

      const [nameValue] = parts;
      if (nameValue) {
        const [name, ...valueParts] = nameValue.split('=');
        const cookieName = name.trim();
        cookieObj.name = cookieName;
        cookieObj.value = valueParts.join('=').trim();

        for (const part of parts.slice(1)) {
          const [key, ...valueParts] = part.split('=');
          const value = valueParts.join('=').trim();
          if (key) {
            const keyLower = key.toLowerCase();
            cookieObj[keyLower] = value || 'true';

            if (keyLower === 'expires' && value) {
              try {
                const timestamp = Date.parse(value);
                if (!isNaN(timestamp)) {
                  cookieObj.expires_timestamp = timestamp;
                }
              } catch (e) {
                // 忽略
              }
            }
          }
        }

        if (cookieObj.name) {
          cookieMap.set(cookieName, cookieObj);
        }
      }
    }

    return Array.from(cookieMap.values());
  }

  private stringify(parsedCookie: CookieEntity[]): string {
    return parsedCookie
      .filter(cookie => cookie.value && cookie.value !== 'EXPIRED')
      .map(cookie => `${cookie.name}=${cookie.value}`)
      .join('; ');
  }
}

class CookieStore {
  store: Map<string, AccountCookie> = new Map<string, AccountCookie>();

  async getAccountCookie(authKey: string): Promise<AccountCookie | null> {
    let cachedAccountCookie = this.store.get(authKey);

    if (!cachedAccountCookie) {
      const cookieValue = await getMpCookie(authKey);
      if (!cookieValue) {
        return null;
      }

      cachedAccountCookie = AccountCookie.create(
        cookieValue.token, 
        cookieValue.cookies,
        cookieValue.createdAt,
        cookieValue.refreshedAt
      );
      this.store.set(authKey, cachedAccountCookie);
    }

    // 检查是否过期
    if (cachedAccountCookie.isExpired) {
      console.log(`[CookieStore] Cookie expired for authKey: ${authKey}`);
      await this.clearCookie(authKey);
      return null;
    }

    return cachedAccountCookie;
  }

  async getCookie(authKey: string): Promise<string | null> {
    const accountCookie = await this.getAccountCookie(authKey);
    if (!accountCookie) {
      return null;
    }
    return accountCookie.toString();
  }

  async setCookie(authKey: string, token: string, cookie: string[]): Promise<boolean> {
    const accountCookie = new AccountCookie(token, cookie);
    this.store.set(authKey, accountCookie);
    return await setMpCookie(authKey, accountCookie.toJSON(), {
      expirationTtl: 7 * 24 * 60 * 60, // 7天
    });
  }

  // 刷新cookie（更新刷新时间）
  async refreshCookie(authKey: string): Promise<boolean> {
    const accountCookie = this.store.get(authKey);
    if (!accountCookie) {
      return false;
    }
    
    // 更新内存中的刷新时间
    const refreshedCookie = new AccountCookie(
      accountCookie.token,
      accountCookie.toString().split('; '),
      accountCookie.createdAt,
      Date.now() // 新的刷新时间
    );
    this.store.set(authKey, refreshedCookie);
    
    // 更新存储
    await updateRefreshTime(authKey);
    console.log(`[CookieStore] Refreshed cookie for authKey: ${authKey}`);
    return true;
  }

  async clearCookie(authKey: string): Promise<void> {
    this.store.delete(authKey);
    await deleteMpCookie(authKey);
  }

  async getToken(authKey: string): Promise<string | null> {
    const accountCookie = await this.getAccountCookie(authKey);
    if (!accountCookie) {
      return null;
    }
    return accountCookie.token;
  }

  // 获取所有需要刷新的cookie
  getAllNeedRefresh(): string[] {
    const result: string[] = [];
    for (const [authKey, cookie] of this.store) {
      if (cookie.needsRefresh) {
        result.push(authKey);
      }
    }
    return result;
  }

  toJSON(): Record<string, AccountCookie> {
    const json: Record<string, AccountCookie> = {};
    for (const [authKey, accountCookie] of this.store) {
      json[authKey] = accountCookie;
    }
    return json;
  }
}

export const cookieStore = new CookieStore();

export async function getCookieFromStore(event: H3Event): Promise<string | null> {
  let cookie: string | null = null;
  let authKey = getRequestHeader(event, 'X-Auth-Key');
  
  if (authKey) {
    cookie = await cookieStore.getCookie(authKey);
    if (cookie) return cookie;
  }

  const cookies = parseCookies(event);
  authKey = cookies['auth-key'];
  if (authKey) {
    cookie = await cookieStore.getCookie(authKey);
    if (cookie) return cookie;
  }

  return null;
}

export async function getTokenFromStore(event: H3Event): Promise<string | null> {
  let token: string | null = null;
  let authKey = getRequestHeader(event, 'X-Auth-Key');
  
  if (authKey) {
    token = await cookieStore.getToken(authKey);
    if (token) return token;
  }

  const cookies = parseCookies(event);
  authKey = cookies['auth-key'];
  if (authKey) {
    token = await cookieStore.getToken(authKey);
    if (token) return token;
  }

  return null;
}

export function getCookiesFromRequest(event: H3Event): string {
  const cookies = parseCookies(event);
  return Object.keys(cookies)
    .map(key => `${key}=${encodeURIComponent(cookies[key])}`)
    .join('; ');
}

export function getCookieFromResponse(name: string, response: Response): string | null {
  const cookies = AccountCookie.parse(response.headers.getSetCookie());
  const targetCookie = cookies.find(cookie => cookie.name === name);
  if (targetCookie) {
    return targetCookie.value as string;
  }
  return null;
}
