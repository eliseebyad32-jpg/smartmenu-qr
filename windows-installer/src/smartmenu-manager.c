#define _WIN32_WINNT 0x0601
#ifndef UNICODE
#define UNICODE
#endif
#ifndef _UNICODE
#define _UNICODE
#endif

#include <winsock2.h>
#include <ws2tcpip.h>
#include <iphlpapi.h>
#include <windows.h>
#include <winhttp.h>
#include <commctrl.h>
#include <commdlg.h>
#include <shellapi.h>
#include <shlobj.h>
#include <shlwapi.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define IDI_SMARTMENU          101
#define WM_TRAYICON            (WM_USER + 10)
#define WM_APP_STOP_AND_EXIT   (WM_USER + 42)
#define WM_APP_SHOW_WINDOW     (WM_USER + 43)
#define WM_APP_PROBE_RESULT    (WM_USER + 44)
#define WM_APP_SYNC_RESULT     (WM_USER + 45)

#define IDC_BTN_TOGGLE_SERVER  1001
#define IDC_BTN_OPEN_BROWSER   1002
#define IDC_BTN_COPY_WIFI      1003
#define IDC_BTN_SYNC_CLOUD     1004
#define IDC_BTN_SETTINGS       1005
#define IDC_BTN_UPDATE_EXE     1006
#define IDC_BTN_LOGS           1007
#define IDC_CHK_AUTOSTART      1008
#define IDC_BTN_MINIMIZE_TRAY  1009
#define IDC_BTN_QUIT           1010

#define IDC_LBL_STATUS_VAL     1101
#define IDC_LBL_CATALOG_VAL    1102
#define IDC_LBL_LOCAL_VAL      1103
#define IDC_LBL_WIFI_VAL       1104
#define IDC_LBL_QR_VAL         1105
#define IDC_LBL_INFO_MSG       1106

#define IDM_TRAY_OPEN          2001
#define IDM_TRAY_BROWSER       2002
#define IDM_TRAY_COPY_WIFI     2003
#define IDM_TRAY_SYNC          2004
#define IDM_TRAY_TOGGLE        2005
#define IDM_TRAY_QUIT          2006

#define IDC_SET_CHK_ISOLATE    3001
#define IDC_SET_TXT_SLUG       3002
#define IDC_SET_TXT_PORT       3003
#define IDC_SET_TXT_SB_URL     3004
#define IDC_SET_TXT_SB_KEY     3005
#define IDC_SET_BTN_SAVE       3006
#define IDC_SET_BTN_CANCEL     3007

#define IDT_PROBE_TIMER        1

static const WCHAR g_wndClass[] = L"SmartMenuQRManagerClass";
static const WCHAR g_settingsClass[] = L"SmartMenuQRSettingsClass";

typedef struct {
    int port;
    WCHAR restaurantSlug[128];
    WCHAR publicLanUrl[256];
    WCHAR supabaseUrl[256];
    WCHAR supabaseAnonKey[512];
} AppConfig;

typedef struct {
    BOOL serverHealthy;
    BOOL catalogReady;
    int catalogStatusCode;
    int restaurantsCount;
    int itemsCount;
    WCHAR lanIp[64];
    WCHAR serverPrimaryLanUrl[256];
} ProbeResult;

static HINSTANCE g_hInst = NULL;
static HWND g_hWnd = NULL;
static HFONT g_fontNormal = NULL;
static HFONT g_fontBold = NULL;
static HFONT g_fontTitle = NULL;
static HICON g_hIcon = NULL;
static NOTIFYICONDATAW g_nid;
static BOOL g_trayAdded = FALSE;
static BOOL g_balloonShown = FALSE;

static WCHAR g_exeDir[MAX_PATH];
static WCHAR g_nodeExe[MAX_PATH];
static WCHAR g_serverScript[MAX_PATH];
static WCHAR g_syncScript[MAX_PATH];
static WCHAR g_dataRoot[MAX_PATH];
static WCHAR g_dataDir[MAX_PATH];
static WCHAR g_logsDir[MAX_PATH];
static WCHAR g_configFile[MAX_PATH];
static WCHAR g_envFile[MAX_PATH];
static WCHAR g_logFile[MAX_PATH];
static WCHAR g_pidFile[MAX_PATH];

static HANDLE g_hJob = NULL;
static HANDLE g_hNodeProc = NULL;
static DWORD g_nodePid = 0;
static volatile LONG g_probing = 0;
static volatile LONG g_syncing = 0;

static AppConfig g_cfg;
static ProbeResult g_lastProbe;

static void TrimW(WCHAR *s) {
    if (!s) return;
    size_t len = wcslen(s);
    while (len > 0 && (s[len - 1] == L' ' || s[len - 1] == L'\t' || s[len - 1] == L'\r' || s[len - 1] == L'\n')) {
        s[--len] = L'\0';
    }
    WCHAR *start = s;
    while (*start == L' ' || *start == L'\t' || *start == L'\r' || *start == L'\n') {
        start++;
    }
    if (start != s) {
        memmove(s, start, (wcslen(start) + 1) * sizeof(WCHAR));
    }
}

static void EnsureDirRecursive(const WCHAR *path) {
    SHCreateDirectoryExW(NULL, path, NULL);
}

static BOOL TestDirWritable(const WCHAR *dir) {
    EnsureDirRecursive(dir);
    WCHAR testFile[MAX_PATH];
    _snwprintf(testFile, MAX_PATH, L"%s\\.write_test_%lu", dir, GetCurrentProcessId());
    testFile[MAX_PATH - 1] = L'\0';
    HANDLE h = CreateFileW(testFile, GENERIC_WRITE, 0, NULL, CREATE_ALWAYS, FILE_ATTRIBUTE_TEMPORARY, NULL);
    if (h == INVALID_HANDLE_VALUE) return FALSE;
    CloseHandle(h);
    DeleteFileW(testFile);
    return TRUE;
}

static BOOL FileExistsW(const WCHAR *path) {
    DWORD attr = GetFileAttributesW(path);
    return (attr != INVALID_FILE_ATTRIBUTES && !(attr & FILE_ATTRIBUTE_DIRECTORY));
}

static char *ReadFileUtf8(const WCHAR *path, DWORD *outLen) {
    HANDLE h = CreateFileW(path, GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE, NULL, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL);
    if (h == INVALID_HANDLE_VALUE) return NULL;
    DWORD size = GetFileSize(h, NULL);
    if (size == INVALID_FILE_SIZE || size > 4 * 1024 * 1024) {
        CloseHandle(h);
        return NULL;
    }
    char *buf = (char *)malloc(size + 1);
    if (!buf) {
        CloseHandle(h);
        return NULL;
    }
    DWORD read = 0;
    if (!ReadFile(h, buf, size, &read, NULL)) {
        free(buf);
        CloseHandle(h);
        return NULL;
    }
    buf[read] = '\0';
    CloseHandle(h);
    if (outLen) *outLen = read;
    return buf;
}

static BOOL WriteFileUtf8(const WCHAR *path, const char *content) {
    HANDLE h = CreateFileW(path, GENERIC_WRITE, 0, NULL, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
    if (h == INVALID_HANDLE_VALUE) return FALSE;
    DWORD len = (DWORD)strlen(content);
    DWORD written = 0;
    BOOL ok = WriteFile(h, content, len, &written, NULL);
    CloseHandle(h);
    return ok && written == len;
}

static void Utf8ToWide(const char *src, WCHAR *dst, int dstChars) {
    if (!dst || dstChars <= 0) return;
    dst[0] = L'\0';
    if (!src || !src[0]) return;
    MultiByteToWideChar(CP_UTF8, 0, src, -1, dst, dstChars);
    dst[dstChars - 1] = L'\0';
}

static void WideToUtf8(const WCHAR *src, char *dst, int dstBytes) {
    if (!dst || dstBytes <= 0) return;
    dst[0] = '\0';
    if (!src || !src[0]) return;
    WideCharToMultiByte(CP_UTF8, 0, src, -1, dst, dstBytes, NULL, NULL);
    dst[dstBytes - 1] = '\0';
}

static BOOL ExtractJsonStringField(const char *json, const char *key, char *out, int outCap) {
    if (!json || !key || !out || outCap <= 0) return FALSE;
    out[0] = '\0';
    char pat[128];
    _snprintf(pat, sizeof(pat), "\"%s\"", key);
    const char *p = strstr(json, pat);
    if (!p) return FALSE;
    p += strlen(pat);
    while (*p == ' ' || *p == '\t' || *p == '\r' || *p == '\n') p++;
    if (*p != ':') return FALSE;
    p++;
    while (*p == ' ' || *p == '\t' || *p == '\r' || *p == '\n') p++;
    if (*p != '"') return FALSE;
    p++;
    int i = 0;
    while (*p && *p != '"' && i < outCap - 1) {
        if (*p == '\\' && *(p + 1)) {
            p++;
        }
        out[i++] = *p++;
    }
    out[i] = '\0';
    return TRUE;
}

static int ExtractJsonIntField(const char *json, const char *key, int defVal) {
    if (!json || !key) return defVal;
    char pat[128];
    _snprintf(pat, sizeof(pat), "\"%s\"", key);
    const char *p = strstr(json, pat);
    if (!p) return defVal;
    p += strlen(pat);
    while (*p == ' ' || *p == '\t' || *p == '\r' || *p == '\n') p++;
    if (*p != ':') return defVal;
    p++;
    while (*p == ' ' || *p == '\t' || *p == '\r' || *p == '\n') p++;
    int val = atoi(p);
    return val > 0 ? val : defVal;
}

static void ExtractDotEnvValue(const char *envText, const char *key, char *out, int outCap) {
    out[0] = '\0';
    if (!envText || !key) return;
    size_t klen = strlen(key);
    const char *line = envText;
    while (*line) {
        const char *eol = strchr(line, '\n');
        size_t llen = eol ? (size_t)(eol - line) : strlen(line);
        const char *p = line;
        while ((size_t)(p - line) < llen && (*p == ' ' || *p == '\t')) p++;
        if ((size_t)(line + llen - p) > klen && strncmp(p, key, klen) == 0) {
            const char *eq = p + klen;
            while ((size_t)(eq - line) < llen && (*eq == ' ' || *eq == '\t')) eq++;
            if ((size_t)(eq - line) < llen && *eq == '=') {
                const char *val = eq + 1;
                size_t vlen = (size_t)(line + llen - val);
                while (vlen > 0 && (val[vlen - 1] == '\r' || val[vlen - 1] == ' ' || val[vlen - 1] == '\t')) {
                    vlen--;
                }
                while (vlen > 0 && (*val == ' ' || *val == '\t')) {
                    val++;
                    vlen--;
                }
                if (vlen >= 2 && ((val[0] == '"' && val[vlen - 1] == '"') || (val[0] == '\'' && val[vlen - 1] == '\''))) {
                    val++;
                    vlen -= 2;
                }
                size_t copy = vlen < (size_t)(outCap - 1) ? vlen : (size_t)(outCap - 1);
                memcpy(out, val, copy);
                out[copy] = '\0';
                return;
            }
        }
        if (!eol) break;
        line = eol + 1;
    }
}

static void JsonEscape(const char *src, char *dst, int dstCap) {
    int j = 0;
    for (int i = 0; src[i] && j < dstCap - 2; i++) {
        if (src[i] == '"' || src[i] == '\\') {
            dst[j++] = '\\';
        }
        dst[j++] = src[i];
    }
    dst[j] = '\0';
}

static void LoadAppConfig(void) {
    memset(&g_cfg, 0, sizeof(g_cfg));
    g_cfg.port = 3000;
    wcscpy(g_cfg.restaurantSlug, L"rocomamas-lubumbashi");

    char *cfgJson = ReadFileUtf8(g_configFile, NULL);
    if (cfgJson) {
        g_cfg.port = ExtractJsonIntField(cfgJson, "port", 3000);
        if (g_cfg.port < 1 || g_cfg.port > 65535) g_cfg.port = 3000;

        char slugBuf[128] = {0};
        if (ExtractJsonStringField(cfgJson, "restaurantSlug", slugBuf, sizeof(slugBuf))) {
            Utf8ToWide(slugBuf, g_cfg.restaurantSlug, 128);
        } else if (ExtractJsonStringField(cfgJson, "restaurantId", slugBuf, sizeof(slugBuf))) {
            Utf8ToWide(slugBuf, g_cfg.restaurantSlug, 128);
        }

        char lanBuf[256] = {0};
        if (ExtractJsonStringField(cfgJson, "publicLanUrl", lanBuf, sizeof(lanBuf))) {
            Utf8ToWide(lanBuf, g_cfg.publicLanUrl, 256);
        }
        free(cfgJson);
    }

    char *envText = ReadFileUtf8(g_envFile, NULL);
    if (envText) {
        char urlBuf[256] = {0};
        char keyBuf[512] = {0};
        ExtractDotEnvValue(envText, "VITE_SUPABASE_URL", urlBuf, sizeof(urlBuf));
        ExtractDotEnvValue(envText, "VITE_SUPABASE_ANON_KEY", keyBuf, sizeof(keyBuf));
        Utf8ToWide(urlBuf, g_cfg.supabaseUrl, 256);
        Utf8ToWide(keyBuf, g_cfg.supabaseAnonKey, 512);
        free(envText);
    }
}

static BOOL SaveAppConfig(const AppConfig *cfg) {
    char slugU8[256], slugEsc[256];
    char lanU8[512], lanEsc[512];
    char sbUrlU8[512], sbKeyU8[1024];

    WideToUtf8(cfg->restaurantSlug, slugU8, sizeof(slugU8));
    WideToUtf8(cfg->publicLanUrl, lanU8, sizeof(lanU8));
    WideToUtf8(cfg->supabaseUrl, sbUrlU8, sizeof(sbUrlU8));
    WideToUtf8(cfg->supabaseAnonKey, sbKeyU8, sizeof(sbKeyU8));

    JsonEscape(slugU8, slugEsc, sizeof(slugEsc));
    JsonEscape(lanU8, lanEsc, sizeof(lanEsc));

    char jsonBuf[2048];
    _snprintf(
        jsonBuf,
        sizeof(jsonBuf),
        "{\n"
        "  \"port\": %d,\n"
        "  \"restaurantId\": \"%s\",\n"
        "  \"restaurantSlug\": \"%s\",\n"
        "  \"publicLanUrl\": \"%s\",\n"
        "  \"autoSyncMinutes\": 5\n"
        "}\n",
        cfg->port,
        slugEsc,
        slugEsc,
        lanEsc
    );

    char envBuf[2048];
    _snprintf(
        envBuf,
        sizeof(envBuf),
        "VITE_SUPABASE_URL=\"%s\"\n"
        "VITE_SUPABASE_ANON_KEY=\"%s\"\n",
        sbUrlU8,
        sbKeyU8
    );

    BOOL ok1 = WriteFileUtf8(g_configFile, jsonBuf);
    BOOL ok2 = WriteFileUtf8(g_envFile, envBuf);
    return ok1 && ok2;
}

static void InitPaths(void) {
    GetModuleFileNameW(NULL, g_exeDir, MAX_PATH);
    PathRemoveFileSpecW(g_exeDir);

    _snwprintf(g_nodeExe, MAX_PATH, L"%s\\runtime\\node.exe", g_exeDir);
    if (!FileExistsW(g_nodeExe)) {
        WCHAR progFilesNode[MAX_PATH];
        ExpandEnvironmentStringsW(L"%ProgramFiles%\\nodejs\\node.exe", progFilesNode, MAX_PATH);
        if (FileExistsW(progFilesNode)) {
            wcscpy(g_nodeExe, progFilesNode);
        } else {
            wcscpy(g_nodeExe, L"node.exe");
        }
    }

    _snwprintf(g_serverScript, MAX_PATH, L"%s\\app\\local-server\\server.mjs", g_exeDir);
    _snwprintf(g_syncScript, MAX_PATH, L"%s\\app\\local-server\\sync-cloud.mjs", g_exeDir);
    if (!FileExistsW(g_serverScript)) {
        _snwprintf(g_serverScript, MAX_PATH, L"%s\\local-server\\server.mjs", g_exeDir);
        _snwprintf(g_syncScript, MAX_PATH, L"%s\\local-server\\sync-cloud.mjs", g_exeDir);
    }

    WCHAR commonApp[MAX_PATH] = {0};
    if (SUCCEEDED(SHGetFolderPathW(NULL, CSIDL_COMMON_APPDATA, NULL, SHGFP_TYPE_CURRENT, commonApp))) {
        _snwprintf(g_dataRoot, MAX_PATH, L"%s\\SmartMenuQR", commonApp);
        if (!TestDirWritable(g_dataRoot)) {
            commonApp[0] = L'\0';
        }
    }
    if (!commonApp[0]) {
        WCHAR localApp[MAX_PATH] = {0};
        SHGetFolderPathW(NULL, CSIDL_LOCAL_APPDATA, NULL, SHGFP_TYPE_CURRENT, localApp);
        _snwprintf(g_dataRoot, MAX_PATH, L"%s\\SmartMenuQR", localApp);
        EnsureDirRecursive(g_dataRoot);
    }

    _snwprintf(g_dataDir, MAX_PATH, L"%s\\data", g_dataRoot);
    _snwprintf(g_logsDir, MAX_PATH, L"%s\\logs", g_dataRoot);
    _snwprintf(g_configFile, MAX_PATH, L"%s\\config.json", g_dataRoot);
    _snwprintf(g_envFile, MAX_PATH, L"%s\\.env", g_dataRoot);
    _snwprintf(g_logFile, MAX_PATH, L"%s\\server.log", g_logsDir);
    _snwprintf(g_pidFile, MAX_PATH, L"%s\\server.pid", g_dataDir);

    EnsureDirRecursive(g_dataDir);
    EnsureDirRecursive(g_logsDir);

    LoadAppConfig();
}

static BOOL IsVirtualAdapterName(const WCHAR *name) {
    if (!name) return FALSE;
    const WCHAR *bad[] = {
        L"Virtual", L"VMware", L"VirtualBox", L"Hyper-V", L"vEthernet",
        L"WSL", L"Docker", L"Loopback", L"Tailscale", L"Hamachi", L"Bluetooth"
    };
    for (size_t i = 0; i < sizeof(bad) / sizeof(bad[0]); i++) {
        if (StrStrIW(name, bad[i]) != NULL) return TRUE;
    }
    return FALSE;
}

static void DetectBestLanIp(WCHAR *outIp, int outCap) {
    outIp[0] = L'\0';
    ULONG bufLen = 16384;
    PIP_ADAPTER_ADDRESSES addrs = (PIP_ADAPTER_ADDRESSES)malloc(bufLen);
    if (!addrs) return;

    DWORD ret = GetAdaptersAddresses(AF_INET, GAA_FLAG_SKIP_ANYCAST | GAA_FLAG_SKIP_MULTICAST | GAA_FLAG_SKIP_DNS_SERVER, NULL, addrs, &bufLen);
    if (ret == ERROR_BUFFER_OVERFLOW) {
        free(addrs);
        addrs = (PIP_ADAPTER_ADDRESSES)malloc(bufLen);
        if (!addrs) return;
        ret = GetAdaptersAddresses(AF_INET, GAA_FLAG_SKIP_ANYCAST | GAA_FLAG_SKIP_MULTICAST | GAA_FLAG_SKIP_DNS_SERVER, NULL, addrs, &bufLen);
    }

    if (ret != NO_ERROR) {
        free(addrs);
        return;
    }

    int bestScore = -9999;
    WCHAR bestIp[64] = {0};

    for (PIP_ADAPTER_ADDRESSES cur = addrs; cur != NULL; cur = cur->Next) {
        if (cur->OperStatus != IfOperStatusUp) continue;
        if (cur->IfType == IF_TYPE_SOFTWARE_LOOPBACK) continue;

        for (PIP_ADAPTER_UNICAST_ADDRESS ua = cur->FirstUnicastAddress; ua != NULL; ua = ua->Next) {
            if (!ua->Address.lpSockaddr || ua->Address.lpSockaddr->sa_family != AF_INET) continue;
            struct sockaddr_in *sa = (struct sockaddr_in *)ua->Address.lpSockaddr;
            char ipA[64] = {0};
            if (!inet_ntop(AF_INET, &sa->sin_addr, ipA, sizeof(ipA))) continue;
            if (strncmp(ipA, "127.", 4) == 0 || strncmp(ipA, "169.254.", 8) == 0) continue;

            int score = 0;
            if (cur->IfType == IF_TYPE_IEEE80211) score += 30;
            else if (cur->IfType == IF_TYPE_ETHERNET_CSMACD) score += 20;

            if (cur->FriendlyName && StrStrIW(cur->FriendlyName, L"Wi-Fi") != NULL) score += 10;
            if (IsVirtualAdapterName(cur->Description) || IsVirtualAdapterName(cur->FriendlyName)) score -= 60;

            if (strncmp(ipA, "192.168.", 8) == 0) score += 15;
            else if (strncmp(ipA, "10.", 3) == 0) score += 10;
            else if (strncmp(ipA, "172.", 4) == 0) score += 5;

            if (score > bestScore) {
                bestScore = score;
                Utf8ToWide(ipA, bestIp, 64);
            }
        }
    }

    free(addrs);
    if (bestIp[0]) {
        wcsncpy(outIp, bestIp, outCap - 1);
        outIp[outCap - 1] = L'\0';
    }
}

static BOOL HttpLocalGet(int port, const WCHAR *path, int *outStatus, char *outBody, int outBodyCap) {
    if (outStatus) *outStatus = 0;
    if (outBody && outBodyCap > 0) outBody[0] = '\0';

    HINTERNET hSession = WinHttpOpen(L"SmartMenuQRManager/1.0", WINHTTP_ACCESS_TYPE_NO_PROXY, WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0);
    if (!hSession) return FALSE;

    WinHttpSetTimeouts(hSession, 500, 600, 600, 800);

    HINTERNET hConnect = WinHttpConnect(hSession, L"127.0.0.1", (INTERNET_PORT)port, 0);
    if (!hConnect) {
        WinHttpCloseHandle(hSession);
        return FALSE;
    }

    HINTERNET hReq = WinHttpOpenRequest(hConnect, L"GET", path, NULL, WINHTTP_NO_REFERER, WINHTTP_DEFAULT_ACCEPT_TYPES, 0);
    if (!hReq) {
        WinHttpCloseHandle(hConnect);
        WinHttpCloseHandle(hSession);
        return FALSE;
    }

    BOOL ok = WinHttpSendRequest(hReq, WINHTTP_NO_ADDITIONAL_HEADERS, 0, WINHTTP_NO_REQUEST_DATA, 0, 0, 0)
              && WinHttpReceiveResponse(hReq, NULL);

    if (ok) {
        DWORD status = 0;
        DWORD sz = sizeof(status);
        WinHttpQueryHeaders(hReq, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER, WINHTTP_HEADER_NAME_BY_INDEX, &status, &sz, WINHTTP_NO_HEADER_INDEX);
        if (outStatus) *outStatus = (int)status;

        if (outBody && outBodyCap > 1) {
            int total = 0;
            DWORD avail = 0;
            while (WinHttpQueryDataAvailable(hReq, &avail) && avail > 0 && total < outBodyCap - 1) {
                DWORD toRead = avail;
                if (toRead > (DWORD)(outBodyCap - 1 - total)) {
                    toRead = (DWORD)(outBodyCap - 1 - total);
                }
                DWORD readBytes = 0;
                if (!WinHttpReadData(hReq, outBody + total, toRead, &readBytes) || readBytes == 0) break;
                total += (int)readBytes;
                if (avail > toRead) break;
            }
            outBody[total] = '\0';
        }
    }

    WinHttpCloseHandle(hReq);
    WinHttpCloseHandle(hConnect);
    WinHttpCloseHandle(hSession);
    return ok;
}

static int CountOccurrences(const char *haystack, const char *needle) {
    if (!haystack || !needle || !needle[0]) return 0;
    int count = 0;
    size_t nlen = strlen(needle);
    const char *p = haystack;
    while ((p = strstr(p, needle)) != NULL) {
        count++;
        p += nlen;
    }
    return count;
}

static DWORD WINAPI ProbeThreadProc(LPVOID param) {
    (void)param;
    ProbeResult *res = (ProbeResult *)calloc(1, sizeof(ProbeResult));
    if (!res) {
        InterlockedExchange(&g_probing, 0);
        return 0;
    }

    DetectBestLanIp(res->lanIp, 64);

    int statusHealth = 0;
    char bodyHealth[2048] = {0};
    if (HttpLocalGet(g_cfg.port, L"/api/health", &statusHealth, bodyHealth, sizeof(bodyHealth)) &&
        statusHealth == 200 &&
        strstr(bodyHealth, "local-lan-server") != NULL) {
        res->serverHealthy = TRUE;

        char lanBuf[256] = {0};
        if (ExtractJsonStringField(bodyHealth, "primaryLanUrl", lanBuf, sizeof(lanBuf))) {
            Utf8ToWide(lanBuf, res->serverPrimaryLanUrl, 256);
        }

        int statusCat = 0;
        char *catBody = (char *)malloc(262144);
        if (catBody) {
            if (HttpLocalGet(g_cfg.port, L"/api/catalog", &statusCat, catBody, 262144)) {
                res->catalogStatusCode = statusCat;
                if (statusCat == 200 && strstr(catBody, "\"restaurants\"") != NULL) {
                    res->catalogReady = TRUE;
                    const char *menuPos = strstr(catBody, "\"menuItems\"");
                    const char *catPos = strstr(catBody, "\"categories\"");
                    if (catPos && catPos > catBody) {
                        size_t restSpan = (size_t)(catPos - catBody);
                        char *restSlice = (char *)malloc(restSpan + 1);
                        if (restSlice) {
                            memcpy(restSlice, catBody, restSpan);
                            restSlice[restSpan] = '\0';
                            res->restaurantsCount = CountOccurrences(restSlice, "\"slug\"");
                            free(restSlice);
                        }
                    }
                    if (menuPos) {
                        res->itemsCount = CountOccurrences(menuPos, "\"priceFC\"");
                    }
                }
            }
            free(catBody);
        }
    }

    InterlockedExchange(&g_probing, 0);
    if (g_hWnd && IsWindow(g_hWnd)) {
        PostMessageW(g_hWnd, WM_APP_PROBE_RESULT, 0, (LPARAM)res);
    } else {
        free(res);
    }
    return 0;
}

static void ScheduleProbe(void) {
    if (InterlockedCompareExchange(&g_probing, 1, 0) != 0) return;
    HANDLE hThread = CreateThread(NULL, 0, ProbeThreadProc, NULL, 0, NULL);
    if (hThread) CloseHandle(hThread);
    else InterlockedExchange(&g_probing, 0);
}

static WCHAR *BuildNodeEnvBlock(void) {
    LPWCH baseEnv = GetEnvironmentStringsW();
    if (!baseEnv) return NULL;

    size_t totalChars = 0;
    for (LPCWCH p = baseEnv; *p; ) {
        size_t len = wcslen(p) + 1;
        if (_wcsnicmp(p, L"SMARTMENU_DATA_DIR=", 19) != 0 &&
            _wcsnicmp(p, L"SMARTMENU_CONFIG_FILE=", 22) != 0 &&
            _wcsnicmp(p, L"SMARTMENU_ENV_FILE=", 19) != 0 &&
            _wcsnicmp(p, L"NODE_ENV=", 9) != 0) {
            totalChars += len;
        }
        p += len;
    }

    WCHAR e1[MAX_PATH + 32], e2[MAX_PATH + 32], e3[MAX_PATH + 32];
    const WCHAR *e4 = L"NODE_ENV=production";
    _snwprintf(e1, MAX_PATH + 32, L"SMARTMENU_DATA_DIR=%s", g_dataDir);
    _snwprintf(e2, MAX_PATH + 32, L"SMARTMENU_CONFIG_FILE=%s", g_configFile);
    _snwprintf(e3, MAX_PATH + 32, L"SMARTMENU_ENV_FILE=%s", g_envFile);

    totalChars += wcslen(e1) + 1 + wcslen(e2) + 1 + wcslen(e3) + 1 + wcslen(e4) + 1 + 1;

    WCHAR *block = (WCHAR *)calloc(totalChars, sizeof(WCHAR));
    if (!block) {
        FreeEnvironmentStringsW(baseEnv);
        return NULL;
    }

    WCHAR *dst = block;
    for (LPCWCH p = baseEnv; *p; ) {
        size_t len = wcslen(p) + 1;
        if (_wcsnicmp(p, L"SMARTMENU_DATA_DIR=", 19) != 0 &&
            _wcsnicmp(p, L"SMARTMENU_CONFIG_FILE=", 22) != 0 &&
            _wcsnicmp(p, L"SMARTMENU_ENV_FILE=", 19) != 0 &&
            _wcsnicmp(p, L"NODE_ENV=", 9) != 0) {
            memcpy(dst, p, len * sizeof(WCHAR));
            dst += len;
        }
        p += len;
    }

    const WCHAR *extras[4] = { e1, e2, e3, e4 };
    for (int i = 0; i < 4; i++) {
        size_t len = wcslen(extras[i]) + 1;
        memcpy(dst, extras[i], len * sizeof(WCHAR));
        dst += len;
    }
    *dst = L'\0';

    FreeEnvironmentStringsW(baseEnv);
    return block;
}

static BOOL IsManagedServerRunning(void) {
    if (g_hNodeProc) {
        DWORD code = 0;
        if (GetExitCodeProcess(g_hNodeProc, &code) && code == STILL_ACTIVE) {
            return TRUE;
        }
        CloseHandle(g_hNodeProc);
        g_hNodeProc = NULL;
        g_nodePid = 0;
    }
    return g_lastProbe.serverHealthy;
}

static void StopLocalServer(void) {
    if (g_hNodeProc) {
        DWORD code = 0;
        if (GetExitCodeProcess(g_hNodeProc, &code) && code == STILL_ACTIVE) {
            TerminateProcess(g_hNodeProc, 0);
            WaitForSingleObject(g_hNodeProc, 3000);
        }
        CloseHandle(g_hNodeProc);
        g_hNodeProc = NULL;
        g_nodePid = 0;
    }

    if (FileExistsW(g_pidFile)) {
        char *pidStr = ReadFileUtf8(g_pidFile, NULL);
        if (pidStr) {
            DWORD pid = (DWORD)strtoul(pidStr, NULL, 10);
            free(pidStr);
            if (pid > 0 && pid != GetCurrentProcessId()) {
                HANDLE hOther = OpenProcess(PROCESS_TERMINATE | SYNCHRONIZE, FALSE, pid);
                if (hOther) {
                    TerminateProcess(hOther, 0);
                    WaitForSingleObject(hOther, 2500);
                    CloseHandle(hOther);
                }
            }
        }
        DeleteFileW(g_pidFile);
    }

    g_lastProbe.serverHealthy = FALSE;
    g_lastProbe.catalogReady = FALSE;
    ScheduleProbe();
}

static BOOL StartLocalServer(WCHAR *errOut, int errCap) {
    if (errOut && errCap > 0) errOut[0] = L'\0';

    if (g_hNodeProc) {
        DWORD code = 0;
        if (GetExitCodeProcess(g_hNodeProc, &code) && code == STILL_ACTIVE) {
            return TRUE;
        }
        CloseHandle(g_hNodeProc);
        g_hNodeProc = NULL;
    }

    // Check if already responding cleanly
    int hStatus = 0;
    char hBody[1024] = {0};
    if (HttpLocalGet(g_cfg.port, L"/api/health", &hStatus, hBody, sizeof(hBody)) &&
        hStatus == 200 && strstr(hBody, "local-lan-server") != NULL) {
        g_lastProbe.serverHealthy = TRUE;
        ScheduleProbe();
        return TRUE;
    }

    if (!FileExistsW(g_serverScript)) {
        if (errOut) _snwprintf(errOut, errCap, L"Script serveur introuvable : %s", g_serverScript);
        return FALSE;
    }

    EnsureDirRecursive(g_dataDir);
    EnsureDirRecursive(g_logsDir);

    // Rotate log if larger than 2 MB
    WIN32_FILE_ATTRIBUTE_DATA fad;
    if (GetFileAttributesExW(g_logFile, GetFileExInfoStandard, &fad) && fad.nFileSizeLow > 2 * 1024 * 1024) {
        DeleteFileW(g_logFile);
    }

    SECURITY_ATTRIBUTES sa;
    memset(&sa, 0, sizeof(sa));
    sa.nLength = sizeof(sa);
    sa.bInheritHandle = TRUE;

    HANDLE hLog = CreateFileW(g_logFile, FILE_APPEND_DATA, FILE_SHARE_READ | FILE_SHARE_WRITE, &sa, OPEN_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
    HANDLE hNullIn = CreateFileW(L"NUL", GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE, &sa, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL);

    STARTUPINFOW si;
    memset(&si, 0, sizeof(si));
    si.cb = sizeof(si);
    si.dwFlags = STARTF_USESHOWWINDOW | STARTF_USESTDHANDLES;
    si.wShowWindow = SW_HIDE;
    si.hStdInput = (hNullIn != INVALID_HANDLE_VALUE) ? hNullIn : GetStdHandle(STD_INPUT_HANDLE);
    si.hStdOutput = (hLog != INVALID_HANDLE_VALUE) ? hLog : GetStdHandle(STD_OUTPUT_HANDLE);
    si.hStdError = (hLog != INVALID_HANDLE_VALUE) ? hLog : GetStdHandle(STD_ERROR_HANDLE);

    WCHAR cmdLine[MAX_PATH * 3];
    _snwprintf(cmdLine, MAX_PATH * 3, L"\"%s\" \"%s\"", g_nodeExe, g_serverScript);

    WCHAR workDir[MAX_PATH];
    wcscpy(workDir, g_exeDir);
    WCHAR appSub[MAX_PATH];
    _snwprintf(appSub, MAX_PATH, L"%s\\app", g_exeDir);
    if (GetFileAttributesW(appSub) != INVALID_FILE_ATTRIBUTES) {
        wcscpy(workDir, appSub);
    }

    WCHAR *envBlock = BuildNodeEnvBlock();
    PROCESS_INFORMATION pi;
    memset(&pi, 0, sizeof(pi));

    BOOL created = CreateProcessW(
        NULL,
        cmdLine,
        NULL,
        NULL,
        TRUE,
        CREATE_NO_WINDOW | CREATE_UNICODE_ENVIRONMENT,
        envBlock,
        workDir,
        &si,
        &pi
    );

    if (envBlock) free(envBlock);
    if (hLog != INVALID_HANDLE_VALUE) CloseHandle(hLog);
    if (hNullIn != INVALID_HANDLE_VALUE) CloseHandle(hNullIn);

    if (!created) {
        if (errOut) {
            _snwprintf(errOut, errCap, L"Impossible de lancer Node.js (code %lu).", GetLastError());
        }
        return FALSE;
    }

    if (g_hJob) {
        AssignProcessToJobObject(g_hJob, pi.hProcess);
    }
    g_hNodeProc = pi.hProcess;
    g_nodePid = pi.dwProcessId;
    CloseHandle(pi.hThread);

    ScheduleProbe();
    return TRUE;
}

static DWORD WINAPI SyncThreadProc(LPVOID param) {
    (void)param;
    BOOL ok = FALSE;
    WCHAR *msg = (WCHAR *)calloc(256, sizeof(WCHAR));
    if (!msg) {
        InterlockedExchange(&g_syncing, 0);
        return 0;
    }

    if (!FileExistsW(g_syncScript)) {
        wcscpy(msg, L"Script sync-cloud.mjs introuvable.");
    } else {
        WCHAR cmdLine[MAX_PATH * 3];
        _snwprintf(cmdLine, MAX_PATH * 3, L"\"%s\" \"%s\" --timeout=12000", g_nodeExe, g_syncScript);

        WCHAR workDir[MAX_PATH];
        wcscpy(workDir, g_exeDir);
        WCHAR appSub[MAX_PATH];
        _snwprintf(appSub, MAX_PATH, L"%s\\app", g_exeDir);
        if (GetFileAttributesW(appSub) != INVALID_FILE_ATTRIBUTES) {
            wcscpy(workDir, appSub);
        }

        WCHAR *envBlock = BuildNodeEnvBlock();
        STARTUPINFOW si;
        memset(&si, 0, sizeof(si));
        si.cb = sizeof(si);
        si.dwFlags = STARTF_USESHOWWINDOW;
        si.wShowWindow = SW_HIDE;

        PROCESS_INFORMATION pi;
        memset(&pi, 0, sizeof(pi));

        if (CreateProcessW(NULL, cmdLine, NULL, NULL, FALSE, CREATE_NO_WINDOW | CREATE_UNICODE_ENVIRONMENT, envBlock, workDir, &si, &pi)) {
            WaitForSingleObject(pi.hProcess, 18000);
            DWORD code = 1;
            GetExitCodeProcess(pi.hProcess, &code);
            CloseHandle(pi.hProcess);
            CloseHandle(pi.hThread);
            ok = (code == 0);
            if (ok) {
                wcscpy(msg, L"Synchronisation Cloud vérifiée (données locales à jour).");
            } else {
                wcscpy(msg, L"Synchronisation interrompue (vérifiez la connexion Internet).");
            }
        } else {
            wcscpy(msg, L"Impossible d'exécuter la synchronisation.");
        }
        if (envBlock) free(envBlock);
    }

    InterlockedExchange(&g_syncing, 0);
    if (g_hWnd && IsWindow(g_hWnd)) {
        PostMessageW(g_hWnd, WM_APP_SYNC_RESULT, (WPARAM)ok, (LPARAM)msg);
    } else {
        free(msg);
    }
    return 0;
}

static void TriggerCloudSync(void) {
    if (InterlockedCompareExchange(&g_syncing, 1, 0) != 0) return;
    SetWindowTextW(GetDlgItem(g_hWnd, IDC_LBL_INFO_MSG), L"Synchronisation avec Supabase en cours...");
    HANDLE hThread = CreateThread(NULL, 0, SyncThreadProc, NULL, 0, NULL);
    if (hThread) CloseHandle(hThread);
    else InterlockedExchange(&g_syncing, 0);
}

static BOOL IsAutoStartEnabled(void) {
    HKEY hKey = NULL;
    if (RegOpenKeyExW(HKEY_CURRENT_USER, L"Software\\Microsoft\\Windows\\CurrentVersion\\Run", 0, KEY_READ, &hKey) != ERROR_SUCCESS) {
        return FALSE;
    }
    WCHAR val[MAX_PATH * 2] = {0};
    DWORD sz = sizeof(val);
    DWORD type = 0;
    LSTATUS st = RegQueryValueExW(hKey, L"SmartMenuQR", NULL, &type, (LPBYTE)val, &sz);
    RegCloseKey(hKey);
    return (st == ERROR_SUCCESS && (type == REG_SZ || type == REG_EXPAND_SZ) && val[0] != L'\0');
}

static void SetAutoStartEnabled(BOOL enable) {
    HKEY hKey = NULL;
    if (RegCreateKeyExW(HKEY_CURRENT_USER, L"Software\\Microsoft\\Windows\\CurrentVersion\\Run", 0, NULL, 0, KEY_SET_VALUE, NULL, &hKey, NULL) != ERROR_SUCCESS) {
        return;
    }
    if (enable) {
        WCHAR exePath[MAX_PATH];
        GetModuleFileNameW(NULL, exePath, MAX_PATH);
        WCHAR cmd[MAX_PATH + 32];
        _snwprintf(cmd, MAX_PATH + 32, L"\"%s\" --autostart", exePath);
        RegSetValueExW(hKey, L"SmartMenuQR", 0, REG_SZ, (const BYTE *)cmd, (DWORD)((wcslen(cmd) + 1) * sizeof(WCHAR)));
    } else {
        RegDeleteValueW(hKey, L"SmartMenuQR");
    }
    RegCloseKey(hKey);
}

static void CopyTextToClipboard(const WCHAR *text) {
    if (!text || !text[0]) return;
    if (!OpenClipboard(g_hWnd)) return;
    EmptyClipboard();
    size_t bytes = (wcslen(text) + 1) * sizeof(WCHAR);
    HGLOBAL hMem = GlobalAlloc(GMEM_MOVEABLE, bytes);
    if (hMem) {
        void *ptr = GlobalLock(hMem);
        if (ptr) {
            memcpy(ptr, text, bytes);
            GlobalUnlock(hMem);
            SetClipboardData(CF_UNICODETEXT, hMem);
        }
    }
    CloseClipboard();
}

static void BuildWifiUrl(WCHAR *outUrl, int cap, BOOL withSlug) {
    if (g_cfg.publicLanUrl[0]) {
        wcsncpy(outUrl, g_cfg.publicLanUrl, cap - 1);
        outUrl[cap - 1] = L'\0';
    } else if (g_lastProbe.serverPrimaryLanUrl[0]) {
        wcsncpy(outUrl, g_lastProbe.serverPrimaryLanUrl, cap - 1);
        outUrl[cap - 1] = L'\0';
    } else if (g_lastProbe.lanIp[0]) {
        _snwprintf(outUrl, cap, L"http://%s:%d", g_lastProbe.lanIp, g_cfg.port);
    } else {
        _snwprintf(outUrl, cap, L"http://localhost:%d", g_cfg.port);
    }
    if (withSlug && g_cfg.restaurantSlug[0]) {
        WCHAR tmp[384];
        _snwprintf(tmp, 384, L"%s/?restaurant=%s", outUrl, g_cfg.restaurantSlug);
        wcsncpy(outUrl, tmp, cap - 1);
        outUrl[cap - 1] = L'\0';
    }
}

static void RefreshUi(void) {
    if (!g_hWnd) return;

    BOOL running = IsManagedServerRunning();
    WCHAR statusBuf[128];
    if (g_lastProbe.serverHealthy) {
        _snwprintf(statusBuf, 128, L"● En ligne (Port %d — Prêt pour les téléphones)", g_cfg.port);
    } else if (running) {
        _snwprintf(statusBuf, 128, L"● Démarrage en cours (Port %d)...", g_cfg.port);
    } else {
        wcscpy(statusBuf, L"○ Arrêté");
    }
    SetWindowTextW(GetDlgItem(g_hWnd, IDC_LBL_STATUS_VAL), statusBuf);

    WCHAR catBuf[160];
    if (!g_lastProbe.serverHealthy) {
        wcscpy(catBuf, L"Serveur arrêté");
    } else if (g_lastProbe.catalogReady) {
        if (g_lastProbe.restaurantsCount > 0 || g_lastProbe.itemsCount > 0) {
            _snwprintf(catBuf, 160, L"OK — %d restaurant(s), %d plat(s) disponibles hors ligne",
                g_lastProbe.restaurantsCount > 0 ? g_lastProbe.restaurantsCount : 1,
                g_lastProbe.itemsCount);
        } else {
            wcscpy(catBuf, L"OK — Catalogue local actif (/api/catalog)");
        }
    } else if (g_lastProbe.catalogStatusCode == 404) {
        wcscpy(catBuf, L"En attente d'une 1ère synchronisation ou création de menu");
    } else {
        wcscpy(catBuf, L"Vérification en cours...");
    }
    SetWindowTextW(GetDlgItem(g_hWnd, IDC_LBL_CATALOG_VAL), catBuf);

    WCHAR localUrl[128];
    _snwprintf(localUrl, 128, L"http://localhost:%d", g_cfg.port);
    SetWindowTextW(GetDlgItem(g_hWnd, IDC_LBL_LOCAL_VAL), localUrl);

    WCHAR wifiUrl[256];
    if (g_lastProbe.lanIp[0] || g_cfg.publicLanUrl[0] || g_lastProbe.serverPrimaryLanUrl[0]) {
        BuildWifiUrl(wifiUrl, 256, FALSE);
    } else {
        wcscpy(wifiUrl, L"Aucun réseau Wi-Fi détecté (vérifiez la connexion du PC)");
    }
    SetWindowTextW(GetDlgItem(g_hWnd, IDC_LBL_WIFI_VAL), wifiUrl);

    WCHAR qrUrl[384];
    BuildWifiUrl(qrUrl, 384, TRUE);
    SetWindowTextW(GetDlgItem(g_hWnd, IDC_LBL_QR_VAL), qrUrl);

    SetWindowTextW(
        GetDlgItem(g_hWnd, IDC_BTN_TOGGLE_SERVER),
        running ? L"Arrêter le serveur" : L"Démarrer le serveur"
    );

    if (g_trayAdded) {
        _snwprintf(
            g_nid.szTip,
            ARRAYSIZE(g_nid.szTip),
            L"SmartMenu QR (%s)",
            g_lastProbe.serverHealthy ? L"Serveur actif" : L"Arrêté"
        );
        g_nid.uFlags = NIF_TIP;
        Shell_NotifyIconW(NIM_MODIFY, &g_nid);
    }
}

static LRESULT CALLBACK SettingsWndProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam) {
    (void)lParam;
    switch (msg) {
        case WM_COMMAND: {
            WORD id = LOWORD(wParam);
            if (id == IDC_SET_CHK_ISOLATE) {
                BOOL checked = (SendDlgItemMessageW(hwnd, IDC_SET_CHK_ISOLATE, BM_GETCHECK, 0, 0) == BST_CHECKED);
                EnableWindow(GetDlgItem(hwnd, IDC_SET_TXT_SLUG), checked);
                return 0;
            }
            if (id == IDC_SET_BTN_CANCEL) {
                DestroyWindow(hwnd);
                return 0;
            }
            if (id == IDC_SET_BTN_SAVE) {
                AppConfig next = g_cfg;
                BOOL isolate = (SendDlgItemMessageW(hwnd, IDC_SET_CHK_ISOLATE, BM_GETCHECK, 0, 0) == BST_CHECKED);
                if (isolate) {
                    GetDlgItemTextW(hwnd, IDC_SET_TXT_SLUG, next.restaurantSlug, ARRAYSIZE(next.restaurantSlug));
                    TrimW(next.restaurantSlug);
                } else {
                    next.restaurantSlug[0] = L'\0';
                }

                WCHAR portStr[32] = {0};
                GetDlgItemTextW(hwnd, IDC_SET_TXT_PORT, portStr, 32);
                int port = _wtoi(portStr);
                if (port < 1 || port > 65535) port = 3000;
                next.port = port;

                GetDlgItemTextW(hwnd, IDC_SET_TXT_SB_URL, next.supabaseUrl, ARRAYSIZE(next.supabaseUrl));
                GetDlgItemTextW(hwnd, IDC_SET_TXT_SB_KEY, next.supabaseAnonKey, ARRAYSIZE(next.supabaseAnonKey));
                TrimW(next.supabaseUrl);
                TrimW(next.supabaseAnonKey);

                if (SaveAppConfig(&next)) {
                    g_cfg = next;
                    BOOL wasRunning = IsManagedServerRunning();
                    if (wasRunning) {
                        StopLocalServer();
                        WCHAR err[256];
                        StartLocalServer(err, 256);
                    }
                    RefreshUi();
                    SetWindowTextW(GetDlgItem(g_hWnd, IDC_LBL_INFO_MSG), L"Paramètres enregistrés et appliqués.");
                    DestroyWindow(hwnd);
                } else {
                    MessageBoxW(hwnd, L"Impossible d'enregistrer les paramètres dans ProgramData\\SmartMenuQR.", L"Erreur", MB_OK | MB_ICONERROR);
                }
                return 0;
            }
            break;
        }
        case WM_CLOSE:
            DestroyWindow(hwnd);
            return 0;
    }
    return DefWindowProcW(hwnd, msg, wParam, lParam);
}

static void OpenSettingsDialog(HWND parent) {
    WNDCLASSW wc = {0};
    wc.lpfnWndProc = SettingsWndProc;
    wc.hInstance = g_hInst;
    wc.hIcon = g_hIcon;
    wc.hCursor = LoadCursorW(NULL, IDC_ARROW);
    wc.hbrBackground = (HBRUSH)(COLOR_BTNFACE + 1);
    wc.lpszClassName = g_settingsClass;
    RegisterClassW(&wc);

    RECT rc;
    GetWindowRect(parent, &rc);
    int w = 500, h = 365;
    int x = rc.left + ((rc.right - rc.left) - w) / 2;
    int y = rc.top + ((rc.bottom - rc.top) - h) / 2;

    HWND dlg = CreateWindowExW(
        WS_EX_DLGMODALFRAME,
        g_settingsClass,
        L"Paramètres du serveur local — SmartMenu QR",
        WS_POPUP | WS_CAPTION | WS_SYSMENU,
        x, y, w, h,
        parent, NULL, g_hInst, NULL
    );
    if (!dlg) return;

    HWND hChk = CreateWindowExW(0, L"BUTTON", L"Isoler ce PC sur un seul restaurant (recommandé en salle)",
        WS_CHILD | WS_VISIBLE | BS_AUTOCHECKBOX, 20, 18, 445, 22, dlg, (HMENU)IDC_SET_CHK_ISOLATE, g_hInst, NULL);
    SendMessageW(hChk, WM_SETFONT, (WPARAM)g_fontNormal, TRUE);
    SendMessageW(hChk, BM_SETCHECK, g_cfg.restaurantSlug[0] ? BST_CHECKED : BST_UNCHECKED, 0);

    HWND l1 = CreateWindowExW(0, L"STATIC", L"Identifiant / Slug du restaurant :", WS_CHILD | WS_VISIBLE, 20, 50, 290, 18, dlg, NULL, g_hInst, NULL);
    HWND t1 = CreateWindowExW(WS_EX_CLIENTEDGE, L"EDIT", g_cfg.restaurantSlug, WS_CHILD | WS_VISIBLE | ES_AUTOHSCROLL, 20, 70, 320, 24, dlg, (HMENU)IDC_SET_TXT_SLUG, g_hInst, NULL);
    EnableWindow(t1, g_cfg.restaurantSlug[0] ? TRUE : FALSE);

    HWND l2 = CreateWindowExW(0, L"STATIC", L"Port local :", WS_CHILD | WS_VISIBLE, 355, 50, 110, 18, dlg, NULL, g_hInst, NULL);
    WCHAR portBuf[16];
    _snwprintf(portBuf, 16, L"%d", g_cfg.port);
    HWND t2 = CreateWindowExW(WS_EX_CLIENTEDGE, L"EDIT", portBuf, WS_CHILD | WS_VISIBLE | ES_NUMBER, 355, 70, 110, 24, dlg, (HMENU)IDC_SET_TXT_PORT, g_hInst, NULL);

    HWND l3 = CreateWindowExW(0, L"STATIC", L"URL Supabase (optionnel — pour synchronisation Cloud) :", WS_CHILD | WS_VISIBLE, 20, 108, 445, 18, dlg, NULL, g_hInst, NULL);
    HWND t3 = CreateWindowExW(WS_EX_CLIENTEDGE, L"EDIT", g_cfg.supabaseUrl, WS_CHILD | WS_VISIBLE | ES_AUTOHSCROLL, 20, 128, 445, 24, dlg, (HMENU)IDC_SET_TXT_SB_URL, g_hInst, NULL);

    HWND l4 = CreateWindowExW(0, L"STATIC", L"Clé publique Anon Supabase (optionnel) :", WS_CHILD | WS_VISIBLE, 20, 166, 445, 18, dlg, NULL, g_hInst, NULL);
    HWND t4 = CreateWindowExW(WS_EX_CLIENTEDGE, L"EDIT", g_cfg.supabaseAnonKey, WS_CHILD | WS_VISIBLE | ES_AUTOHSCROLL, 20, 186, 445, 24, dlg, (HMENU)IDC_SET_TXT_SB_KEY, g_hInst, NULL);

    HWND l5 = CreateWindowExW(0, L"STATIC", L"Les données locales (menus, images, comptes) sont conservées dans ProgramData\\SmartMenuQR.",
        WS_CHILD | WS_VISIBLE, 20, 224, 445, 34, dlg, NULL, g_hInst, NULL);

    HWND bSave = CreateWindowExW(0, L"BUTTON", L"Enregistrer et appliquer", WS_CHILD | WS_VISIBLE | BS_DEFPUSHBUTTON, 20, 272, 215, 34, dlg, (HMENU)IDC_SET_BTN_SAVE, g_hInst, NULL);
    HWND bCancel = CreateWindowExW(0, L"BUTTON", L"Annuler", WS_CHILD | WS_VISIBLE, 250, 272, 215, 34, dlg, (HMENU)IDC_SET_BTN_CANCEL, g_hInst, NULL);

    HWND ctrls[] = { l1, t1, l2, t2, l3, t3, l4, t4, l5, bSave, bCancel };
    for (size_t i = 0; i < sizeof(ctrls) / sizeof(ctrls[0]); i++) {
        SendMessageW(ctrls[i], WM_SETFONT, (WPARAM)g_fontNormal, TRUE);
    }

    ShowWindow(dlg, SW_SHOW);
    UpdateWindow(dlg);
}

static void TriggerExeUpdate(void) {
    WCHAR filePath[MAX_PATH] = {0};
    OPENFILENAMEW ofn;
    memset(&ofn, 0, sizeof(ofn));
    ofn.lStructSize = sizeof(ofn);
    ofn.hwndOwner = g_hWnd;
    ofn.lpstrFilter = L"Installateur SmartMenu QR (*.exe)\0*.exe\0";
    ofn.lpstrFile = filePath;
    ofn.nMaxFile = MAX_PATH;
    ofn.lpstrTitle = L"Sélectionnez le nouvel installateur SmartMenu-QR-Setup.exe";
    ofn.Flags = OFN_FILEMUSTEXIST | OFN_PATHMUSTEXIST;

    if (!GetOpenFileNameW(&ofn)) return;

    int confirm = MessageBoxW(
        g_hWnd,
        L"L'installateur sélectionné va mettre à jour SmartMenu QR.\n\n"
        L"Toutes vos données locales (menus, prix, photos, comptes et configuration) seront automatiquement conservées.\n\n"
        L"Voulez-vous lancer la mise à jour maintenant ?",
        L"Mise à jour de SmartMenu QR",
        MB_YESNO | MB_ICONINFORMATION
    );
    if (confirm != IDYES) return;

    StopLocalServer();
    ShellExecuteW(NULL, L"open", filePath, NULL, NULL, SW_SHOWNORMAL);
    PostMessageW(g_hWnd, WM_APP_STOP_AND_EXIT, 0, 0);
}

static void ShowTrayMenu(HWND hwnd) {
    POINT pt;
    GetCursorPos(&pt);

    HMENU hMenu = CreatePopupMenu();
    AppendMenuW(hMenu, MF_STRING, IDM_TRAY_OPEN, L"Ouvrir SmartMenu QR");
    SetMenuDefaultItem(hMenu, IDM_TRAY_OPEN, FALSE);
    AppendMenuW(hMenu, MF_STRING, IDM_TRAY_BROWSER, L"Ouvrir le menu dans le navigateur");
    AppendMenuW(hMenu, MF_STRING, IDM_TRAY_COPY_WIFI, L"Copier l'adresse Wi-Fi");
    AppendMenuW(hMenu, MF_STRING, IDM_TRAY_SYNC, L"Synchroniser depuis Supabase");
    AppendMenuW(hMenu, MF_SEPARATOR, 0, NULL);
    AppendMenuW(hMenu, MF_STRING, IDM_TRAY_TOGGLE, IsManagedServerRunning() ? L"Arrêter le serveur" : L"Démarrer le serveur");
    AppendMenuW(hMenu, MF_STRING, IDM_TRAY_QUIT, L"Arrêter et Quitter");

    SetForegroundWindow(hwnd);
    TrackPopupMenu(hMenu, TPM_BOTTOMALIGN | TPM_LEFTALIGN, pt.x, pt.y, 0, hwnd, NULL);
    DestroyMenu(hMenu);
}

static void AddTrayIcon(HWND hwnd) {
    memset(&g_nid, 0, sizeof(g_nid));
    g_nid.cbSize = sizeof(g_nid);
    g_nid.hWnd = hwnd;
    g_nid.uID = 1;
    g_nid.uFlags = NIF_ICON | NIF_MESSAGE | NIF_TIP;
    g_nid.uCallbackMessage = WM_TRAYICON;
    g_nid.hIcon = g_hIcon;
    wcscpy(g_nid.szTip, L"SmartMenu QR — Serveur Local Wi-Fi");
    g_trayAdded = Shell_NotifyIconW(NIM_ADD, &g_nid);
}

static void ShowBalloonOnce(const WCHAR *title, const WCHAR *text) {
    if (!g_trayAdded || g_balloonShown) return;
    g_balloonShown = TRUE;
    g_nid.uFlags = NIF_INFO;
    wcsncpy(g_nid.szInfoTitle, title, ARRAYSIZE(g_nid.szInfoTitle) - 1);
    wcsncpy(g_nid.szInfo, text, ARRAYSIZE(g_nid.szInfo) - 1);
    g_nid.dwInfoFlags = NIIF_INFO;
    Shell_NotifyIconW(NIM_MODIFY, &g_nid);
}

static void OpenInBrowser(void) {
    WCHAR url[128];
    _snwprintf(url, 128, L"http://localhost:%d", g_cfg.port);
    ShellExecuteW(NULL, L"open", url, NULL, NULL, SW_SHOWNORMAL);
}

static void CreateMainControls(HWND hwnd) {
    g_fontNormal = CreateFontW(-14, 0, 0, 0, FW_NORMAL, FALSE, FALSE, FALSE, DEFAULT_CHARSET,
        OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, CLEARTYPE_QUALITY, DEFAULT_PITCH | FF_DONTCARE, L"Segoe UI");
    g_fontBold = CreateFontW(-14, 0, 0, 0, FW_SEMIBOLD, FALSE, FALSE, FALSE, DEFAULT_CHARSET,
        OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, CLEARTYPE_QUALITY, DEFAULT_PITCH | FF_DONTCARE, L"Segoe UI");
    g_fontTitle = CreateFontW(-20, 0, 0, 0, FW_BOLD, FALSE, FALSE, FALSE, DEFAULT_CHARSET,
        OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, CLEARTYPE_QUALITY, DEFAULT_PITCH | FF_DONTCARE, L"Segoe UI");

    HWND hTitle = CreateWindowExW(0, L"STATIC", L"SMARTMENU QR — Serveur Local Wi-Fi",
        WS_CHILD | WS_VISIBLE, 20, 14, 520, 28, hwnd, NULL, g_hInst, NULL);
    SendMessageW(hTitle, WM_SETFONT, (WPARAM)g_fontTitle, TRUE);

    HWND hSub = CreateWindowExW(0, L"STATIC", L"Contrôle en 1 clic du serveur de menu numérique sur le réseau Wi-Fi du restaurant.",
        WS_CHILD | WS_VISIBLE, 20, 44, 540, 20, hwnd, NULL, g_hInst, NULL);
    SendMessageW(hSub, WM_SETFONT, (WPARAM)g_fontNormal, TRUE);

    HWND hGrp = CreateWindowExW(0, L"BUTTON", L"État en direct et adresses Wi-Fi",
        WS_CHILD | WS_VISIBLE | BS_GROUPBOX, 20, 74, 545, 165, hwnd, NULL, g_hInst, NULL);
    SendMessageW(hGrp, WM_SETFONT, (WPARAM)g_fontBold, TRUE);

    const WCHAR *labels[5] = {
        L"Serveur local :",
        L"Base /api/catalog :",
        L"Adresse PC :",
        L"Adresse Wi-Fi :",
        L"Lien QR direct :"
    };
    int valIds[5] = {
        IDC_LBL_STATUS_VAL,
        IDC_LBL_CATALOG_VAL,
        IDC_LBL_LOCAL_VAL,
        IDC_LBL_WIFI_VAL,
        IDC_LBL_QR_VAL
    };

    for (int i = 0; i < 5; i++) {
        int y = 100 + i * 26;
        HWND hl = CreateWindowExW(0, L"STATIC", labels[i], WS_CHILD | WS_VISIBLE, 34, y, 130, 20, hwnd, NULL, g_hInst, NULL);
        SendMessageW(hl, WM_SETFONT, (WPARAM)g_fontBold, TRUE);

        HWND hv = CreateWindowExW(0, L"STATIC", L"...", WS_CHILD | WS_VISIBLE | SS_ENDELLIPSIS,
            168, y, 385, 20, hwnd, (HMENU)(INT_PTR)valIds[i], g_hInst, NULL);
        SendMessageW(hv, WM_SETFONT, (WPARAM)g_fontNormal, TRUE);
    }

    HWND bToggle = CreateWindowExW(0, L"BUTTON", L"Arrêter le serveur",
        WS_CHILD | WS_VISIBLE | BS_DEFPUSHBUTTON, 20, 252, 265, 38, hwnd, (HMENU)IDC_BTN_TOGGLE_SERVER, g_hInst, NULL);
    HWND bBrowser = CreateWindowExW(0, L"BUTTON", L"Ouvrir dans le navigateur",
        WS_CHILD | WS_VISIBLE, 300, 252, 265, 38, hwnd, (HMENU)IDC_BTN_OPEN_BROWSER, g_hInst, NULL);

    HWND bCopy = CreateWindowExW(0, L"BUTTON", L"Copier l'adresse Wi-Fi",
        WS_CHILD | WS_VISIBLE, 20, 300, 265, 36, hwnd, (HMENU)IDC_BTN_COPY_WIFI, g_hInst, NULL);
    HWND bSync = CreateWindowExW(0, L"BUTTON", L"Synchroniser depuis Supabase",
        WS_CHILD | WS_VISIBLE, 300, 300, 265, 36, hwnd, (HMENU)IDC_BTN_SYNC_CLOUD, g_hInst, NULL);

    HWND bSet = CreateWindowExW(0, L"BUTTON", L"Paramètres...",
        WS_CHILD | WS_VISIBLE, 20, 348, 174, 32, hwnd, (HMENU)IDC_BTN_SETTINGS, g_hInst, NULL);
    HWND bUpd = CreateWindowExW(0, L"BUTTON", L"Mettre à jour (.exe)...",
        WS_CHILD | WS_VISIBLE, 205, 348, 174, 32, hwnd, (HMENU)IDC_BTN_UPDATE_EXE, g_hInst, NULL);
    HWND bLogs = CreateWindowExW(0, L"BUTTON", L"Journal serveur",
        WS_CHILD | WS_VISIBLE, 391, 348, 174, 32, hwnd, (HMENU)IDC_BTN_LOGS, g_hInst, NULL);

    HWND chkAuto = CreateWindowExW(0, L"BUTTON", L"Lancer automatiquement après le démarrage de Windows",
        WS_CHILD | WS_VISIBLE | BS_AUTOCHECKBOX, 20, 394, 545, 22, hwnd, (HMENU)IDC_CHK_AUTOSTART, g_hInst, NULL);
    SendMessageW(chkAuto, BM_SETCHECK, IsAutoStartEnabled() ? BST_CHECKED : BST_UNCHECKED, 0);

    HWND hInfo = CreateWindowExW(0, L"STATIC", L"Prêt. Vos données locales sont conservées automatiquement.",
        WS_CHILD | WS_VISIBLE | SS_ENDELLIPSIS, 20, 424, 545, 20, hwnd, (HMENU)IDC_LBL_INFO_MSG, g_hInst, NULL);

    HWND bTray = CreateWindowExW(0, L"BUTTON", L"Réduire près de l'horloge",
        WS_CHILD | WS_VISIBLE, 20, 454, 265, 32, hwnd, (HMENU)IDC_BTN_MINIMIZE_TRAY, g_hInst, NULL);
    HWND bQuit = CreateWindowExW(0, L"BUTTON", L"Arrêter et Quitter",
        WS_CHILD | WS_VISIBLE, 300, 454, 265, 32, hwnd, (HMENU)IDC_BTN_QUIT, g_hInst, NULL);

    HWND btns[] = { bToggle, bBrowser, bCopy, bSync, bSet, bUpd, bLogs, chkAuto, hInfo, bTray, bQuit };
    for (size_t i = 0; i < sizeof(btns) / sizeof(btns[0]); i++) {
        SendMessageW(btns[i], WM_SETFONT, (WPARAM)g_fontNormal, TRUE);
    }
    SendMessageW(bToggle, WM_SETFONT, (WPARAM)g_fontBold, TRUE);
}

static LRESULT CALLBACK MainWndProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam) {
    switch (msg) {
        case WM_CREATE:
            CreateMainControls(hwnd);
            AddTrayIcon(hwnd);
            SetTimer(hwnd, IDT_PROBE_TIMER, 2500, NULL);
            return 0;

        case WM_TIMER:
            if (wParam == IDT_PROBE_TIMER) {
                ScheduleProbe();
            }
            return 0;

        case WM_APP_PROBE_RESULT: {
            ProbeResult *res = (ProbeResult *)lParam;
            if (res) {
                g_lastProbe = *res;
                free(res);
                RefreshUi();
            }
            return 0;
        }

        case WM_APP_SYNC_RESULT: {
            WCHAR *msgText = (WCHAR *)lParam;
            if (msgText) {
                SetWindowTextW(GetDlgItem(hwnd, IDC_LBL_INFO_MSG), msgText);
                free(msgText);
            }
            ScheduleProbe();
            return 0;
        }

        case WM_APP_SHOW_WINDOW:
            ShowWindow(hwnd, SW_RESTORE);
            SetForegroundWindow(hwnd);
            ScheduleProbe();
            return 0;

        case WM_APP_STOP_AND_EXIT:
            KillTimer(hwnd, IDT_PROBE_TIMER);
            StopLocalServer();
            if (g_trayAdded) {
                Shell_NotifyIconW(NIM_DELETE, &g_nid);
                g_trayAdded = FALSE;
            }
            DestroyWindow(hwnd);
            return 0;

        case WM_TRAYICON:
            if (lParam == WM_LBUTTONDBLCLK) {
                ShowWindow(hwnd, SW_RESTORE);
                SetForegroundWindow(hwnd);
                ScheduleProbe();
            } else if (lParam == WM_RBUTTONUP || lParam == WM_CONTEXTMENU) {
                ShowTrayMenu(hwnd);
            }
            return 0;

        case WM_COMMAND: {
            WORD id = LOWORD(wParam);
            switch (id) {
                case IDC_BTN_TOGGLE_SERVER:
                case IDM_TRAY_TOGGLE: {
                    if (IsManagedServerRunning()) {
                        StopLocalServer();
                        SetWindowTextW(GetDlgItem(hwnd, IDC_LBL_INFO_MSG), L"Serveur local arrêté.");
                    } else {
                        WCHAR err[256] = {0};
                        if (StartLocalServer(err, 256)) {
                            SetWindowTextW(GetDlgItem(hwnd, IDC_LBL_INFO_MSG), L"Serveur local démarré.");
                        } else {
                            MessageBoxW(hwnd, err[0] ? err : L"Erreur au démarrage.", L"SmartMenu QR", MB_OK | MB_ICONERROR);
                        }
                    }
                    RefreshUi();
                    return 0;
                }
                case IDC_BTN_OPEN_BROWSER:
                case IDM_TRAY_BROWSER:
                    OpenInBrowser();
                    return 0;

                case IDC_BTN_COPY_WIFI:
                case IDM_TRAY_COPY_WIFI: {
                    WCHAR url[384];
                    BuildWifiUrl(url, 384, g_cfg.restaurantSlug[0] ? TRUE : FALSE);
                    CopyTextToClipboard(url);
                    WCHAR info[420];
                    _snwprintf(info, 420, L"Adresse copiée : %s", url);
                    SetWindowTextW(GetDlgItem(hwnd, IDC_LBL_INFO_MSG), info);
                    return 0;
                }

                case IDC_BTN_SYNC_CLOUD:
                case IDM_TRAY_SYNC:
                    TriggerCloudSync();
                    return 0;

                case IDC_BTN_SETTINGS:
                    OpenSettingsDialog(hwnd);
                    return 0;

                case IDC_BTN_UPDATE_EXE:
                    TriggerExeUpdate();
                    return 0;

                case IDC_BTN_LOGS:
                    if (FileExistsW(g_logFile)) {
                        ShellExecuteW(NULL, L"open", L"notepad.exe", g_logFile, NULL, SW_SHOWNORMAL);
                    } else {
                        MessageBoxW(hwnd, L"Aucun journal généré pour le moment.", L"Journal serveur", MB_OK | MB_ICONINFORMATION);
                    }
                    return 0;

                case IDC_CHK_AUTOSTART: {
                    BOOL checked = (SendDlgItemMessageW(hwnd, IDC_CHK_AUTOSTART, BM_GETCHECK, 0, 0) == BST_CHECKED);
                    SetAutoStartEnabled(checked);
                    SetWindowTextW(
                        GetDlgItem(hwnd, IDC_LBL_INFO_MSG),
                        checked
                            ? L"Démarrage automatique avec Windows activé."
                            : L"Démarrage automatique avec Windows désactivé."
                    );
                    return 0;
                }

                case IDC_BTN_MINIMIZE_TRAY:
                    ShowWindow(hwnd, SW_HIDE);
                    ShowBalloonOnce(L"SmartMenu QR", L"Le serveur continue de fonctionner en arrière-plan près de l'horloge.");
                    return 0;

                case IDM_TRAY_OPEN:
                    ShowWindow(hwnd, SW_RESTORE);
                    SetForegroundWindow(hwnd);
                    return 0;

                case IDC_BTN_QUIT:
                case IDM_TRAY_QUIT:
                    SendMessageW(hwnd, WM_APP_STOP_AND_EXIT, 0, 0);
                    return 0;
            }
            break;
        }

        case WM_CLOSE:
            ShowWindow(hwnd, SW_HIDE);
            ShowBalloonOnce(L"SmartMenu QR", L"SmartMenu QR reste actif près de l'horloge. Utilisez « Arrêter et Quitter » pour stopper le serveur.");
            return 0;

        case WM_DESTROY:
            if (g_trayAdded) {
                Shell_NotifyIconW(NIM_DELETE, &g_nid);
                g_trayAdded = FALSE;
            }
            if (g_fontNormal) DeleteObject(g_fontNormal);
            if (g_fontBold) DeleteObject(g_fontBold);
            if (g_fontTitle) DeleteObject(g_fontTitle);
            PostQuitMessage(0);
            return 0;
    }
    return DefWindowProcW(hwnd, msg, wParam, lParam);
}

int WINAPI wWinMain(HINSTANCE hInstance, HINSTANCE hPrevInstance, LPWSTR lpCmdLine, int nCmdShow) {
    (void)hPrevInstance;
    (void)nCmdShow;
    g_hInst = hInstance;

    BOOL isAutoStart = (lpCmdLine && wcsstr(lpCmdLine, L"--autostart") != NULL);
    BOOL isStopCmd = (lpCmdLine && wcsstr(lpCmdLine, L"--stop") != NULL);
    BOOL isSyncCmd = (lpCmdLine && wcsstr(lpCmdLine, L"--sync") != NULL);

    if (isStopCmd) {
        HWND hExisting = FindWindowW(g_wndClass, NULL);
        if (hExisting) {
            PostMessageW(hExisting, WM_APP_STOP_AND_EXIT, 0, 0);
            for (int i = 0; i < 30; i++) {
                if (!FindWindowW(g_wndClass, NULL)) break;
                Sleep(150);
            }
        }
        return 0;
    }

    HANDLE hMutex = CreateMutexW(NULL, FALSE, L"Local\\SmartMenuQR_Manager_Mutex");
    if (hMutex && GetLastError() == ERROR_ALREADY_EXISTS) {
        HWND hExisting = FindWindowW(g_wndClass, NULL);
        if (hExisting && !isAutoStart) {
            PostMessageW(hExisting, WM_APP_SHOW_WINDOW, 0, 0);
        }
        CloseHandle(hMutex);
        return 0;
    }

    WSADATA wsa;
    WSAStartup(MAKEWORD(2, 2), &wsa);

    INITCOMMONCONTROLSEX icc = { sizeof(icc), ICC_STANDARD_CLASSES | ICC_WIN95_CLASSES };
    InitCommonControlsEx(&icc);

    InitPaths();

    g_hJob = CreateJobObjectW(NULL, NULL);
    if (g_hJob) {
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION jeli;
        memset(&jeli, 0, sizeof(jeli));
        jeli.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        SetInformationJobObject(g_hJob, JobObjectExtendedLimitInformation, &jeli, sizeof(jeli));
    }

    g_hIcon = LoadIconW(hInstance, MAKEINTRESOURCEW(IDI_SMARTMENU));
    if (!g_hIcon) g_hIcon = LoadIconW(NULL, IDI_APPLICATION);

    WNDCLASSW wc = {0};
    wc.lpfnWndProc = MainWndProc;
    wc.hInstance = hInstance;
    wc.hIcon = g_hIcon;
    wc.hCursor = LoadCursorW(NULL, IDC_ARROW);
    wc.hbrBackground = (HBRUSH)(COLOR_BTNFACE + 1);
    wc.lpszClassName = g_wndClass;
    RegisterClassW(&wc);

    int winW = 595, winH = 540;
    int screenW = GetSystemMetrics(SM_CXSCREEN);
    int screenH = GetSystemMetrics(SM_CYSCREEN);
    int posX = (screenW - winW) / 2;
    int posY = (screenH - winH) / 2;

    g_hWnd = CreateWindowExW(
        0,
        g_wndClass,
        L"SmartMenu QR — Serveur Local Wi-Fi",
        WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU | WS_MINIMIZEBOX,
        posX, posY, winW, winH,
        NULL, NULL, hInstance, NULL
    );

    if (!g_hWnd) {
        if (hMutex) CloseHandle(hMutex);
        return 1;
    }

    WCHAR startErr[256] = {0};
    if (!StartLocalServer(startErr, 256) && !isAutoStart && startErr[0]) {
        MessageBoxW(g_hWnd, startErr, L"SmartMenu QR", MB_OK | MB_ICONWARNING);
    }
    if (isSyncCmd) {
        TriggerCloudSync();
    }

    RefreshUi();
    ScheduleProbe();

    if (isAutoStart) {
        ShowWindow(g_hWnd, SW_HIDE);
    } else {
        ShowWindow(g_hWnd, SW_SHOW);
        UpdateWindow(g_hWnd);
    }

    MSG msg;
    while (GetMessageW(&msg, NULL, 0, 0) > 0) {
        TranslateMessage(&msg);
        DispatchMessageW(&msg);
    }

    StopLocalServer();
    if (g_hJob) CloseHandle(g_hJob);
    if (hMutex) CloseHandle(hMutex);
    WSACleanup();
    return 0;
}
