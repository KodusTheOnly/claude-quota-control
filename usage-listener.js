// Listens to the answer of the usage request that Claude's usage page makes by itself when it
// opens. The app asks for nothing: it only reads what the page already received.

const ENABLE_LIMIT = 5000;

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// .../api/organizations/<id>/usage, on the page's own origin and nowhere else
function usageUrlPattern(origin) {
  return new RegExp(`^${escapeRe(origin)}/api/organizations/[^/]+/usage(?:\\?.*)?$`);
}

function maskedPath(url) {
  try {
    return new URL(url).pathname
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<id>")
      .replace(/[0-9a-f]{12,}/gi, "<hash>"); // file names made of a long hash (account images and the like)
  } catch {
    return "?";
  }
}

// `webContents` is an Electron WebContents (or anything with the same `debugger`).
// Resolves with an object that fills in by itself: { requested, status, body }. requested: the page sent its
// usage request (an answer may still be on its way).
function listenForUsage(webContents, origin, trace = () => {}) {
  const pattern = usageUrlPattern(origin);
  const dbg = webContents.debugger;
  const got = { requested: false, status: null, body: null };
  const mine = new Set();
  dbg.attach("1.3");
  dbg.on("message", (_e, method, params) => {
    if (method === "Network.requestWillBeSent") {
      if (params.request && pattern.test(params.request.url)) got.requested = true;
    } else if (method === "Network.responseReceived") {
      const url = params.response.url;
      // Only the path, with ids masked: enough to see what the page asks for, nothing personal
      if (url.startsWith(`${origin}/api/`)) trace(`page request ${params.response.status} ${maskedPath(url)}`);
      if (pattern.test(url)) {
        got.requested = true;
        mine.add(params.requestId);
        got.status = params.response.status;
      }
    } else if (method === "Network.loadingFinished" && mine.has(params.requestId)) {
      dbg
        .sendCommand("Network.getResponseBody", { requestId: params.requestId })
        .then((r) => {
          got.body = r.base64Encoded ? Buffer.from(r.body, "base64").toString("utf8") : r.body;
          trace(`usage answer read (${got.body.length} characters)`);
        })
        .catch((e) => trace(`usage answer could not be read: ${e && e.message}`));
    } else if (method === "Network.loadingFailed" && mine.has(params.requestId)) {
      trace(`usage request failed: ${params.errorText}`);
    }
  });
  trace("debugger attached, turning the network listener on");
  // The command can wait forever if the page is not ready, so it gets a limit
  let timer;
  const noAnswer = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("Network.enable did not answer")), ENABLE_LIMIT);
  });
  return Promise.race([dbg.sendCommand("Network.enable"), noAnswer])
    .then(() => got)
    .finally(() => clearTimeout(timer));
}

module.exports = { listenForUsage, usageUrlPattern };
