// fetch 封装：非 2xx 响应抛出携带 status 的错误
export async function api(path, body) {
  const res = await fetch(path, body ? {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  } : undefined);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.detail || "出了点问题，稍后再试";
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return data;
}