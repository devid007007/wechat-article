import { type CookieEntity } from '~/server/utils/CookieStore';

export type CookieKVKey = string;

export interface CookieKVValue {
  token: string;
  cookies: CookieEntity[];
}

export async function setMpCookie(key: CookieKVKey, data: CookieKVValue): Promise<boolean> {
  const kv = useStorage('kv');
  try {
    // 从环境变量读取 TTL，默认 4 天
    const ttlHours = parseInt(process.env.COOKIE_TTL_HOURS || '96', 10); // 96小时=4天
    const ttlSeconds = ttlHours * 60 * 60;
    
    await kv.set<CookieKVValue>(`cookie:${key}`, data, {
      expirationTtl: ttlSeconds,
    });
    return true;
  } catch (err) {
    console.error('kv.set call failed:', err);
    return false;
  }
}

export async function getMpCookie(key: CookieKVKey): Promise<CookieKVValue | null> {
  const kv = useStorage('kv');
  return await kv.get<CookieKVValue>(`cookie:${key}`);
}
