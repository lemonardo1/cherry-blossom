function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function sendText(res, statusCode, text) {
  res.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}

function parseCookies(req) {
  const raw = req.headers.cookie || "";
  return Object.fromEntries(
    raw
      .split(";")
      .map((v) => v.trim())
      .filter(Boolean)
      .map((v) => {
        const idx = v.indexOf("=");
        if (idx < 0) return [v, ""];
        return [v.slice(0, idx), decodeURIComponent(v.slice(idx + 1))];
      })
  );
}

async function parseBody(req) {
  let data = "";
  for await (const chunk of req) data += chunk;
  if (!data) return {};
  try {
    return JSON.parse(data);
  } catch {
    throw new Error("INVALID_JSON");
  }
}

module.exports = {
  sendJson,
  sendText,
  parseCookies,
  parseBody
};
