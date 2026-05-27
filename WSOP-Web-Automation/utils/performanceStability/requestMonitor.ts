import { type Page, type Request } from '@playwright/test';

export type RequestInfo = {
  url: string;
  resourceType: string;
  status?: number;
  durationMs?: number;
  failure?: string;
  startTime: number;
};

export type RequestSummary = {
  totalRequests: number;
  requestsByType: Record<string, number>;
  slowRequests: RequestInfo[];
  failedRequests: RequestInfo[];
  allRequests: RequestInfo[];
};

let requestLog: RequestInfo[] = [];
let activeListeners: {
  page: Page;
  onRequest: (r: Request) => void;
  onFinished: (r: Request) => void;
  onFailed: (r: Request) => void;
} | null = null;

export function startRequestMonitoring(page: Page) {
  // Clear previous log
  requestLog = [];

  // If there's an existing listener, stop it first
  if (activeListeners) {
    stopRequestMonitoring();
  }

  const requestMap = new Map<Request, number>();

  const onRequest = (request: Request) => {
    const startTime = Date.now();
    requestMap.set(request, startTime);
    requestLog.push({
      url: request.url(),
      resourceType: request.resourceType(),
      startTime
    });
  };

  const onFinished = (request: Request) => {
    const startTime = requestMap.get(request);
    if (startTime) {
      const durationMs = Date.now() - startTime;
      const url = request.url();
      const logEntry = requestLog.find(r => r.url === url && r.startTime === startTime);
      if (logEntry) {
        logEntry.durationMs = durationMs;
        const response = request.response();
        if (response) {
          try {
            logEntry.status = typeof response.status === 'function' ? response.status() : (response.status ?? 200);
          } catch (e) {
            logEntry.status = (response as any).status ?? 200;
          }
        } else {
          logEntry.status = 200;
        }
      }
      requestMap.delete(request);
    }
  };

  const onFailed = (request: Request) => {
    const startTime = requestMap.get(request);
    if (startTime) {
      const durationMs = Date.now() - startTime;
      const url = request.url();
      const logEntry = requestLog.find(r => r.url === url && r.startTime === startTime);
      if (logEntry) {
        logEntry.durationMs = durationMs;
        logEntry.failure = request.failure()?.errorText ?? 'Failed';
        logEntry.status = 0;
      }
      requestMap.delete(request);
    }
  };

  page.on('request', onRequest);
  page.on('requestfinished', onFinished);
  page.on('requestfailed', onFailed);

  activeListeners = {
    page,
    onRequest,
    onFinished,
    onFailed
  };
}

export function stopRequestMonitoring(): RequestSummary {
  if (activeListeners) {
    const { page, onRequest, onFinished, onFailed } = activeListeners;
    try {
      page.off('request', onRequest);
      page.off('requestfinished', onFinished);
      page.off('requestfailed', onFailed);
    } catch (e) {
      // Ignore if page is already closed
    }
    activeListeners = null;
  }

  const totalRequests = requestLog.length;
  const requestsByType: Record<string, number> = {};
  const slowRequests: RequestInfo[] = [];
  const failedRequests: RequestInfo[] = [];

  // Define initial boundaries for slow requests (e.g. general 3000ms, or resource specific)
  const slowThreshold = 3000;

  for (const req of requestLog) {
    // Fill requestsByType
    requestsByType[req.resourceType] = (requestsByType[req.resourceType] || 0) + 1;

    // Check failed
    if (req.failure || (req.status && req.status >= 400)) {
      failedRequests.push(req);
    } else if (req.durationMs && req.durationMs >= slowThreshold) {
      slowRequests.push(req);
    }
  }

  return {
    totalRequests,
    requestsByType,
    slowRequests,
    failedRequests,
    allRequests: [...requestLog]
  };
}

export function classifyRequestIssue(
  requestInfo: RequestInfo,
  thresholds: { slowRequestMs: { warning: number; fail: number }; slowAssetMs: { warning: number; fail: number }; allowedThirdPartyFailurePatterns: string[] }
): 'pass' | 'warning' | 'fail' {
  const url = requestInfo.url;
  const isFailed = requestInfo.failure || (requestInfo.status && requestInfo.status >= 400);

  // Check third-party allowed failure patterns
  const isThirdParty = thresholds.allowedThirdPartyFailurePatterns.some(pattern =>
    url.includes(pattern)
  );

  if (isFailed) {
    if (isThirdParty) {
      return 'warning'; // 3rd party ad/analytics block/failure is just a warning
    }
    // Check if it is a core document or API call
    if (requestInfo.resourceType === 'document' || requestInfo.resourceType === 'xhr' || requestInfo.resourceType === 'fetch') {
      return 'fail'; // Critical API/document fail
    }
    return 'warning'; // Other assets failed to load (like non-critical image)
  }

  // Check slow duration
  const duration = requestInfo.durationMs ?? 0;
  const isAsset = ['image', 'media', 'font', 'stylesheet', 'script'].includes(requestInfo.resourceType);
  const slowLimit = isAsset ? thresholds.slowAssetMs : thresholds.slowRequestMs;

  if (duration >= slowLimit.fail) {
    if (isThirdParty) return 'warning';
    return 'fail';
  } else if (duration >= slowLimit.warning) {
    return 'warning';
  }

  return 'pass';
}
