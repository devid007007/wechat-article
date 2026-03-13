import { cookieStore } from './CookieStore';

// 自动刷新任务
export function startAutoRefresh() {
  // 每6小时检查一次
  const CHECK_INTERVAL = 6 * 60 * 60 * 1000; // 6小时
  
  console.log('[AutoRefresh] Started, checking every 6 hours');
  
  setInterval(async () => {
    console.log('[AutoRefresh] Checking cookies...');
    
    const needRefresh = cookieStore.getAllNeedRefresh();
    console.log(`[AutoRefresh] Found ${needRefresh.length} cookies need refresh`);
    
    for (const authKey of needRefresh) {
      try {
        // 这里调用微信的刷新接口（需要实现）
        // 暂时只更新本地时间，实际项目中需要调用微信API
        await cookieStore.refreshCookie(authKey);
        console.log(`[AutoRefresh] Refreshed: ${authKey}`);
      } catch (err) {
        console.error(`[AutoRefresh] Failed to refresh ${authKey}:`, err);
      }
    }
  }, CHECK_INTERVAL);
}

// 启动（在应用启动时调用）
startAutoRefresh();
