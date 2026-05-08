import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import axios from "axios";
import https from "https";
import http from "http";

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Create an axios instance that ignores SSL errors, common in IPTV streams
  const axiosInstance = axios.create({
    httpsAgent: new https.Agent({  
      rejectUnauthorized: false,
      keepAlive: false
    }),
    httpAgent: new http.Agent({
      keepAlive: false
    }),
    maxRedirects: 10,
    validateStatus: () => true
  });

  // Simple Proxy API for CORS bypass
  app.options("/api/proxy", (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "*");
    res.sendStatus(204);
  });

  app.get("/api/proxy", async (req, res) => {
    let urlString = (req.query.url || req.query.b64) as string;
    if (!urlString) {
      return res.status(400).json({ error: "URL is required" });
    }

    // Support Base64 encoded URLs to bypass mpegts.js security checks for credentials (@)
    if (req.query.b64 || urlString.startsWith("base64:")) {
      try {
        const b64Data = urlString.startsWith("base64:") ? urlString.substring(7) : urlString;
        urlString = Buffer.from(b64Data, 'base64').toString('utf-8');
      } catch (err) {
        return res.status(400).json({ error: "Invalid Base64 URL" });
      }
    }

    const requestId = Math.random().toString(36).substring(7);
    console.log(`[PROXY][${requestId}] Start: ${urlString.substring(0, 100)}...`);

    try {
      let urlObj: URL;
      try {
        urlObj = new URL(urlString);
      } catch (e) {
        return res.status(400).json({ error: "Invalid URL provided" });
      }

      // Forward certain headers from the client to the remote server
      const headersToForward: Record<string, string> = {
        "User-Agent": "VLC/3.0.18 LibVLC/3.0.18",
        "Accept": "*/*",
        "Connection": "close",
      };

      if (req.headers["range"]) headersToForward["Range"] = req.headers["range"] as string;
      if (req.headers["accept-language"]) headersToForward["Accept-Language"] = req.headers["accept-language"] as string;
      
      // Some IPTV streams require the referer to match the origin
      headersToForward["Referer"] = urlObj.origin + "/";
      headersToForward["Origin"] = urlObj.origin;

      const controller = new AbortController();
      let isAborted = false;
      let response: any;
      
      req.on("close", () => {
        console.log(`[PROXY][${requestId}] Aborting (client closed)`);
        isAborted = true;
        controller.abort();
        if (response && response.data) {
          try {
            response.data.destroy();
          } catch (e) {}
        }
      });

      response = await axiosInstance.get(urlString, {
        timeout: 60000,
        headers: headersToForward,
        responseType: "stream",
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        validateStatus: () => true,
        decompress: true,
        signal: controller.signal,
      });

      // Special handling for some IPTV providers that quirk on Range or User-Agent
      if (response.status === 416 && headersToForward["Range"]) {
        console.log(`[PROXY][${requestId}] 416 Range Not Satisfiable, retrying without Range`);
        delete headersToForward["Range"];
        response = await axiosInstance.get(urlString, {
          timeout: 60000,
          headers: headersToForward,
          responseType: "stream",
          signal: controller.signal,
          validateStatus: () => true,
          decompress: true
        });
      } else if (response.status === 403 || response.status === 401) {
        console.log(`[PROXY][${requestId}] ${response.status}, retrying with alternative User-Agent`);
        headersToForward["User-Agent"] = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36";
        response = await axiosInstance.get(urlString, {
          timeout: 60000,
          headers: headersToForward,
          responseType: "stream",
          signal: controller.signal,
          validateStatus: () => true,
          decompress: true
        });
      }
      
      console.log(`[PROXY][${requestId}] Status: ${response.status}`);
      
      // Pass the final status code
      res.status(response.status);

      if (response.status >= 400) {
        console.error(`[PROXY][${requestId}] Error: ${response.status}`);
        return res.send(`Remote server error: ${response.status}`);
      }
      
      // Handle redirects if any (Axios handles them, so we check the final URL)
      const finalUrl = (response as any).request?.res?.responseUrl || urlString;
      const finalUrlObj = new URL(finalUrl);
      
      const remoteContentType = (response.headers["content-type"] as string || "").toLowerCase();
      let contentType = remoteContentType || "application/octet-stream";
      
      // Force correct content types for common IPTV extensions if remote is vague
      if (contentType === "application/octet-stream" || contentType === "text/plain") {
        const lowerFinalUrl = finalUrl.toLowerCase();
        const pathname = finalUrlObj.pathname.toLowerCase();
        
        if (lowerFinalUrl.includes(".ts") || pathname.match(/\/\d+$/) || pathname.includes("/video")) {
          contentType = "video/mp2t";
        } else if (lowerFinalUrl.includes(".m3u8")) {
          contentType = "application/x-mpegURL";
        } else if (lowerFinalUrl.includes(".flv")) {
          contentType = "video/x-flv";
        }
      }

      // Detect if it's a manifest (M3U8 / XMLTV)
      let isManifest = contentType.includes("mpegurl") || 
                       contentType.includes("apple.mpegurl") ||
                       contentType.includes("xml") ||
                       finalUrlObj.pathname.toLowerCase().endsWith(".m3u8") || 
                       finalUrlObj.pathname.toLowerCase().endsWith(".m3u") || 
                       finalUrlObj.pathname.toLowerCase().endsWith(".xml") ||
                       finalUrl.toLowerCase().includes(".m3u8") || 
                       finalUrl.toLowerCase().includes(".m3u") ||
                       finalUrl.toLowerCase().includes(".xml") ||
                       finalUrl.toLowerCase().includes("type=m3u");

      // Pass through important headers
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "*");
      res.setHeader("Access-Control-Expose-Headers", "Content-Length, Content-Range, Content-Type, Accept-Ranges");
      res.setHeader("Connection", "close");
      
      if (response.headers["content-length"]) res.setHeader("Content-Length", String(response.headers["content-length"]));
      if (response.headers["content-range"]) res.setHeader("Content-Range", String(response.headers["content-range"]));
      if (response.headers["accept-ranges"]) res.setHeader("Accept-Ranges", String(response.headers["accept-ranges"]));
      if (response.headers["cache-control"]) res.setHeader("Cache-Control", String(response.headers["cache-control"]));

      if (isManifest) {
        // If it's a manifest, we might need to decompress it if we didn't before
        // But for responseType: "stream", axios usually handles it if decompress is true.
        // Let's try to handle potential compression manually or just trust the stream.
        
        let manifestData = "";
        try {
          const chunks = [];
          let totalBytes = 0;
          for await (const chunk of response.data) {
            if (isAborted) break;
            chunks.push(chunk);
            totalBytes += chunk.length;
            if (totalBytes > 100 * 1024 * 1024) { // 100MB limit for EPG/M3U
              console.warn(`[PROXY][${requestId}] Manifest too large (${totalBytes} bytes). Aborting.`);
              response.data.destroy();
              break;
            }
          }
          // Remove BOM if present (common in some text-based IPTV manifests)
          manifestData = Buffer.concat(chunks).toString('utf-8').replace(/^\uFEFF/, '');
          if (manifestData.length < 10) {
            console.warn(`[PROXY] Warning: Manifest data for ${urlString.substring(0, 50)} is very short (${manifestData.length} chars)`);
          }
        } catch (err: any) {
          console.error(`[PROXY] Error reading manifest stream: ${err.message}`);
          return res.status(502).send("Error reading manifest from source");
        }

        // Final check: does it actually look like a HLS manifest or an IPTV playlist?
        // HLS manifests have specific tags like #EXT-X-VERSION or #EXT-X-STREAM-INF or #EXT-X-TARGETDURATION
        // IPTV playlists have #EXTINF or #EXTGRP
        const isHlsManifest = manifestData.includes("#EXT-X-STREAM-INF") || 
                            manifestData.includes("#EXT-X-TARGETDURATION") ||
                            manifestData.includes("#EXT-X-VERSION") ||
                            manifestData.includes("#EXT-X-MEDIA-SEQUENCE");
                            
        const isIptvPlaylist = manifestData.includes("#EXTINF");
        const isXmltv = manifestData.includes("<tv") || manifestData.includes("<!DOCTYPE tv");

        const origin = finalUrlObj.origin;
        const basePath = finalUrlObj.pathname.substring(0, finalUrlObj.pathname.lastIndexOf("/") + 1);
        const baseDir = `${origin}${basePath}`;
        const lineSeparator = manifestData.includes("\r\n") ? "\r\n" : "\n";

        if (isIptvPlaylist && !isHlsManifest) {
          // For IPTV playlists, make relative URLs absolute so the frontend can use them
          const lines = manifestData.split(/\r?\n/);
          const processedLines = lines.map(line => {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith("#")) return line;
            try {
              if (trimmed.startsWith("http")) return line;
              if (trimmed.startsWith("/")) return `${origin}${trimmed}`;
              return new URL(trimmed, baseDir).href;
            } catch {
              return line;
            }
          });
          res.setHeader("Content-Type", "text/plain; charset=utf-8");
          return res.send(processedLines.join(lineSeparator));
        }

        if (isXmltv && !isHlsManifest) {
          res.setHeader("Content-Type", "text/xml; charset=utf-8");
          return res.send(manifestData);
        }

        if (!isHlsManifest && !contentType.includes("mpegurl")) {
          // It's not a manifest after all, just pipe the data we already collected
          res.setHeader("Content-Type", contentType);
          return res.send(Buffer.from(manifestData));
        }

        res.setHeader("Content-Type", "application/x-mpegURL");
        
        const lines = manifestData.split(/\r?\n/);
        const rewrittenLines = lines.map(line => {
          const trimmed = line.trim();
          if (!trimmed) return line;
          
          if (trimmed.startsWith("#")) {
            // Rewrite URIs in tags
            return line.replace(/URI="([^"]+)"/g, (match, uri) => {
              let absoluteUri: string;
              try {
                if (uri.startsWith("http")) {
                  absoluteUri = uri;
                } else if (uri.startsWith("/")) {
                  absoluteUri = `${origin}${uri}`;
                } else {
                  absoluteUri = new URL(uri, baseDir).href;
                }
              } catch {
                absoluteUri = uri;
              }
              return `URI="/api/proxy?b64=${Buffer.from(absoluteUri).toString('base64')}"`;
            });
          }
          
          // Rewrite segment URLs
          let absoluteUrl: string;
          try {
            if (trimmed.startsWith("http")) {
              absoluteUrl = trimmed;
            } else if (trimmed.startsWith("/")) {
              absoluteUrl = `${origin}${trimmed}`;
            } else {
              absoluteUrl = new URL(trimmed, baseDir).href;
            }
          } catch {
            absoluteUrl = trimmed;
          }
          
          return `/api/proxy?b64=${Buffer.from(absoluteUrl).toString('base64')}`;
        });
        
        res.send(rewrittenLines.join(lineSeparator));
      } else {
        res.setHeader("Content-Type", contentType);
        
        response.data.on("error", (err: any) => {
          if (err.message !== "canceled" && err.code !== "ERR_CANCELED" && err.message !== "aborted" && err.code !== "ERR_ABORTED") {
            console.error(`[PROXY][${requestId}] Stream error: ${err.message}`);
          }
        });
        response.data.pipe(res);
      }
    } catch (error: any) {
      if (error.message !== "canceled" && error.code !== "ERR_CANCELED" && error.message !== "aborted" && error.code !== "ERR_ABORTED") {
        console.error(`[PROXY][${requestId}] Fatal error:`, error.message);
        if (!res.headersSent) {
          res.status(502).json({ error: "Proxy connection failed", message: error.message });
        }
      } else {
        console.log(`[PROXY][${requestId}] Canceled`);
        // Just end the response quietly if cancelled by client
        if (!res.headersSent) {
          res.status(499).end(); // 499 is Client Closed Request
        }
      }
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
