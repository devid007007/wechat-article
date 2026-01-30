/**
 * 查询公共代理状态
 */
import { EXTERNAL_API_SERVICE } from '~/config';

export default defineEventHandler(async event => {
  return await fetch(`${EXTERNAL_API_SERVICE}/api/cf-worker/worker-overview-metrics`).then(res => res.json());
});
