/**
 * 查询公共代理状态
 */
import { EXTERNAL_API_SERVICE } from '~/config';

interface NameQuery {
  name: string;
}

export default defineEventHandler(async event => {
  const { name } = getQuery<NameQuery>(event);
  return await fetch(`${EXTERNAL_API_SERVICE}/api/cf-worker/worker-security-top-n?name=${name}`).then(res =>
    res.json()
  );
});
