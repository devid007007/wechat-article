import { type CookieEntity } from '~/server/utils/CookieStore';

export type CookieKVKey = string;

export interface CookieKVValue {
  token: string;
  cookies: CookieEntity[];
}

export async function setMpCookie(key: CookieKVKey, data: CookieKVValue, options?: { expirationTtl?: number }): Promise<boolean> {
  const kv = useStorage('kv');
  try {
    // 优先使用传入的 TTL，否则从环境变量读取，默认 4 天
    const ttlSeconds = options?.expirationTtl || parseInt(process.env.COOKIE_TTL_HOURS || '96', 10) * 60 * 60;
    
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

// 新增：删除 cookie 函数
export async function deleteMpCookie(key: CookieKVKey): Promise<boolean> {
  const kv = useStorage('kv');
  try {
    await kv.removeItem(`cookie:${key}`);
    console.log(`[deleteMpCookie] Deleted cookie for key: ${key}`);
    return true;
  } catch (err) {
    console.error('kv.delete call failed:', err);
    return false;
  }
}
