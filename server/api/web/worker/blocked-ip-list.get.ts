/**
 * 查询 ip 黑名单
 */
import { EXTERNAL_API_SERVICE } from '~/config';

export default defineEventHandler(async event => {
  return await fetch(`${EXTERNAL_API_SERVICE}/api/cf-worker/blocked-ip-list`).then(res => res.json());
});
