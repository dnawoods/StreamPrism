import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import axios from "axios";

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Simple Proxy API for CORS bypass
  app.options("/api/proxy", (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "*");
    res.sendStatus(204);
  });

  app.get("/api/proxy", async (req, res) => {
    const { url } = req.query;
    if (!url || typeof url !== "string") {
      return res.status(400).json({ error: "URL is required" });
    }

    console.log(`Proxy request: ${url.substring(0, 100)}${url.length > 100 ? '...' : ''}`);

    try {
      let urlObj: URL;
      try {
        urlObj = new URL(url);
      } catch (e) {
        return res.status(400).json({ error: "Invalid URL provided" });
      }

      const response = await axios.get(url, {
        timeout: 45000,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "*/*",
          "Accept-Encoding": "identity", // Request uncompressed data to simplify proxying/rewriting
        },
        responseType: "stream",
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        validateStatus: () => true,
        decompress: true, // Use axios decompression if the server sends it anyway
      });
      
      if (response.status >= 400) {
        console.error(`Proxy remote error: ${response.status} for ${url}`);
        return res.status(response.status).send(`Remote server error: ${response.status}`);
      }
      
      const remoteContentType = response.headers["content-type"] as string || "";
      const isManifest = remoteContentType.includes("mpegurl") || 
                         remoteContentType.includes("apple.mpegurl") ||
                         urlObj.pathname.endsWith(".m3u8") || 
                         urlObj.pathname.endsWith(".m3u") || 
                         url.includes("m3u8") || 
                         url.includes("m3u");

      res.setHeader("Content-Type", remoteContentType || (isManifest ? "application/x-mpegURL" : "application/octet-stream"));
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "*");
      
      // Do NOT forward Content-Encoding if we let Axios decompress
      // Or if we requested identity. If it's still compressed, Axios decompress: true will handle it.

      if (isManifest) {
        let manifestData = "";
        try {
          const chunks = [];
          for await (const chunk of response.data) {
            chunks.push(chunk);
          }
          manifestData = Buffer.concat(chunks).toString('utf-8');
        } catch (err: any) {
          console.error("Error reading manifest stream:", err.message);
          return res.status(502).send("Error reading manifest from source");
        }

        const origin = urlObj.origin;
        const basePath = urlObj.pathname.substring(0, urlObj.pathname.lastIndexOf("/") + 1);
        const baseDir = `${origin}${basePath}`;
        
        const lineSeparator = manifestData.includes("\r\n") ? "\r\n" : "\n";
        const lines = manifestData.split(/\r?\n/);
        const rewrittenLines = lines.map(line => {
          line = line.trim();
          if (!line) return line;
          
          if (line.startsWith("#")) {
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
              return `URI="/api/proxy?url=${encodeURIComponent(absoluteUri)}"`;
            });
          }
          
          let absoluteUrl: string;
          try {
            if (line.startsWith("http")) {
              absoluteUrl = line;
            } else if (line.startsWith("/")) {
              absoluteUrl = `${origin}${line}`;
            } else {
              absoluteUrl = new URL(line, baseDir).href;
            }
          } catch {
            absoluteUrl = line;
          }
          
          return `/api/proxy?url=${encodeURIComponent(absoluteUrl)}`;
        });
        
        res.send(rewrittenLines.join(lineSeparator));
      } else {
        response.data.on("error", (err: any) => {
          console.error("Stream error during pipe:", err.message);
        });
        response.data.pipe(res);
      }
    } catch (error: any) {
      console.error(`Serious proxy error for ${url}:`, error.message);
      if (!res.headersSent) {
        res.status(502).json({ error: "Proxy connection failed", message: error.message });
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
