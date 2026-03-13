import { type CookieEntity } from '~/server/utils/CookieStore';

export type CookieKVKey = string;

export interface CookieKVValue {
  token: string;
  cookies: CookieEntity[];
  createdAt: number; // 新增：记录创建时间
  refreshedAt?: number; // 新增：上次刷新时间
}

export async function setMpCookie(key: CookieKVKey, data: CookieKVValue, options?: { expirationTtl?: number }): Promise<boolean> {
  const kv = useStorage('kv');
  try {
    // 优先使用传入的 TTL，否则从环境变量读取，默认 7 天（比微信的4天长）
    const ttlSeconds = options?.expirationTtl || parseInt(process.env.COOKIE_TTL_HOURS || '168', 10) * 60 * 60;
    
    // 记录当前时间
    data.createdAt = Date.now();
    
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

// 删除 cookie
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

// 新增：更新刷新时间
export async function updateRefreshTime(key: CookieKVKey): Promise<boolean> {
  const kv = useStorage('kv');
  try {
    const data = await kv.get<CookieKVValue>(`cookie:${key}`);
    if (data) {
      data.refreshedAt = Date.now();
      await kv.set<CookieKVValue>(`cookie:${key}`, data, {
        expirationTtl: 7 * 24 * 60 * 60, // 7天
      });
    }
    return true;
  } catch (err) {
    console.error('updateRefreshTime failed:', err);
    return false;
  }
}
