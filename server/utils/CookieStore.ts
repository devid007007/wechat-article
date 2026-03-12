import { H3Event, parseCookies, getRequestHeader } from 'h3';
import { CookieKVValue, getMpCookie, setMpCookie, deleteMpCookie } from '~/server/kv/cookie';

// 表示一条 set-cookie 记录的解析结果
export type CookieEntity = Record<string, string | number>;

// 公众号所有的 set-cookie 解析结果
export class AccountCookie {
  private readonly _token: string;
  private _cookie: CookieEntity[];
  private readonly _createdAt: number; // 记录创建时间

  /**
   * @param token
   * @param cookies response.headers.getSetCookie() 的结果，是一个字符串数组
   */
  constructor(token: string, cookies: string[]) {
    this._token = token;
    this._cookie = AccountCookie.parse(cookies);
    this._createdAt = Date.now(); // 记录创建时间
  }

  static create(token: string, cookies: CookieEntity[]): AccountCookie {
    const value = new AccountCookie(token, []);
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
    };
  }

  public get(name: string): CookieEntity | undefined {
    return this._cookie.find(cookie => cookie.name === name);
  }

  public get token() {
    return this._token;
  }

  // 关键修改：强制1小时过期（解决微信服务端1小时失效问题）
  public get isExpired(): boolean {
    const ONE_HOUR = 60 * 60 * 1000; // 1小时 = 3600000毫秒
    const now = Date.now();
    
    // 如果创建时间超过1小时，强制过期
    if (now - this._createdAt > ONE_HOUR) {
      return true;
    }
    
    // 同时检查cookie自带的过期时间
    if (this._cookie.some(cookie => cookie.expires_timestamp)) {
      return this._cookie.some(cookie => 
        cookie.expires_timestamp && cookie.expires_timestamp < now
      );
    }
    
    return false;
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
                // 忽略解析失败
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

// 所有用户的 cookie 仓库
class CookieStore {
  store: Map<string, AccountCookie> = new Map<string, AccountCookie>();

  async getAccountCookie(authKey: string): Promise<AccountCookie | null> {
    // 优先从本地内存取
    let cachedAccountCookie = this.store.get(authKey);

    // 如果内存没有，则从 kv 数据库取
    if (!cachedAccountCookie) {
      const cookieValue = await getMpCookie(authKey);
      if (!cookieValue) {
        return null;
      }

      cachedAccountCookie = AccountCookie.create(cookieValue.token, cookieValue.cookies);
      this.store.set(authKey, cachedAccountCookie);
    }

    // 检查是否过期，如果过期则删除
    if (cachedAccountCookie.isExpired) {
      console.log(`[CookieStore] Cookie expired for authKey: ${authKey}, clearing...`);
      await this.clearCookie(authKey);
      return null;
    }

    return cachedAccountCookie;
  }

  /**
   * 检索用户的cookie
   * @param authKey
   * @return 适合作为请求头的Cookie字符串
   */
  async getCookie(authKey: string): Promise<string | null> {
    const accountCookie = await this.getAccountCookie(authKey);
    if (!accountCookie) {
      return null;
    }
    return accountCookie.toString();
  }

  /**
   * 存储用户的cookie
   * @param authKey
   * @param token
   * @param cookie 原始的 set-cookie 字符串数组
   */
  async setCookie(authKey: string, token: string, cookie: string[]): Promise<boolean> {
    const accountCookie = new AccountCookie(token, cookie);
    this.store.set(authKey, accountCookie);
    // 存储到KV，设置4天过期（但我们会1小时后就认为失效）
    return await setMpCookie(authKey, accountCookie.toJSON(), {
      expirationTtl: 60 * 60 * 24 * 4, // 4天
    });
  }

  /**
   * 清除用户的cookie（新增方法）
   * @param authKey
   */
  async clearCookie(authKey: string): Promise<void> {
    this.store.delete(authKey);
    await deleteMpCookie(authKey);
  }

  /**
   * 检索用户的 token
   * @param authKey
   */
  async getToken(authKey: string): Promise<string | null> {
    const accountCookie = await this.getAccountCookie(authKey);
    if (!accountCookie) {
      return null;
    }

    return accountCookie.token;
  }

  /**
   * 转换为 json 格式，方便存储与传输
   */
  toJSON(): Record<string, AccountCookie> {
    const json: Record<string, AccountCookie> = {};
    for (const [authKey, accountCookie] of this.store) {
      json[authKey] = accountCookie;
    }
    return json;
  }
}

export const cookieStore = new CookieStore();

/**
 * 从 CookieStore 中获取 cookie 字符串
 * @param event
 */
export async function getCookieFromStore(event: H3Event): Promise<string | null> {
  let cookie: string | null = null;

  let authKey = getRequestHeader(event, 'X-Auth-Key');
  if (authKey) {
    cookie = await cookieStore.getCookie(authKey);
    if (cookie) {
      return cookie;
    }
  }

  const cookies = parseCookies(event);
  authKey = cookies['auth-key'];
  if (authKey) {
    cookie = await cookieStore.getCookie(authKey);
    if (cookie) {
      return cookie;
    }
  }

  return null;
}

/**
 * 从 CookieStore 中获取公众号的 token
 * @param event
 */
export async function getTokenFromStore(event: H3Event): Promise<string | null> {
  let token: string | null = null;

  let authKey = getRequestHeader(event, 'X-Auth-Key');
  if (authKey) {
    token = await cookieStore.getToken(authKey);
    if (token) {
      return token;
    }
  }

  const cookies = parseCookies(event);
  authKey = cookies['auth-key'];
  if (authKey) {
    token = await cookieStore.getToken(authKey);
    if (token) {
      return token;
    }
  }

  return null;
}

/**
 * 从请求中获取 cookie 字符串
 * @param event
 */
export function getCookiesFromRequest(event: H3Event): string {
  const cookies = parseCookies(event);
  return Object.keys(cookies)
    .map(key => `${key}=${encodeURIComponent(cookies[key])}`)
    .join('; ');
}

/**
 * 从 response 中获取指定的 set-cookie 的 value 部分
 * @param name cookie 名
 * @param response
 */
export function getCookieFromResponse(name: string, response: Response): string | null {
  const cookies = AccountCookie.parse(response.headers.getSetCookie());
  const targetCookie = cookies.find(cookie => cookie.name === name);
  if (targetCookie) {
    return targetCookie.value as string;
  }
  return null;
}
