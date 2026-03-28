import { chromium, devices } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { spawn } from "node:child_process";

const WORKSPACE_ROOT = process.cwd();
const DEFAULT_PROJECT_DIR = WORKSPACE_ROOT;
const DEFAULT_OUTPUT_ROOT = resolve(
  WORKSPACE_ROOT,
  "artifacts/web-visual-feedback",
);
const DEFAULT_SECTION_SELECTOR = "main [data-section]";
const DEFAULT_PORT = 4173;
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_VIEWPORTS = [
  { name: "desktop", device: "Desktop Chrome" },
  { name: "tablet", device: "iPad Pro 11" },
  { name: "mobile", device: "iPhone 14" },
];

function parseArgs(argv) {
  const options = {
    url: "",
    baseUrl: "",
    readyUrl: "",
    serverCommand: "",
    workingDir: WORKSPACE_ROOT,
    outputDir: "",
    host: DEFAULT_HOST,
    port: DEFAULT_PORT,
    projectDir: DEFAULT_PROJECT_DIR,
    skipBuild: false,
    sectionSelector: DEFAULT_SECTION_SELECTOR,
    section: [],
    viewport: [],
    includePdf: true,
    waitMs: 600,
    variant: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      continue;
    } else if (arg === "--url") {
      options.url = argv[++index] ?? "";
    } else if (arg === "--base-url") {
      options.baseUrl = argv[++index] ?? "";
    } else if (arg === "--ready-url") {
      options.readyUrl = argv[++index] ?? "";
    } else if (arg === "--server-command") {
      options.serverCommand = argv[++index] ?? "";
    } else if (arg === "--working-dir") {
      options.workingDir = resolve(WORKSPACE_ROOT, argv[++index] ?? "");
    } else if (arg === "--output-dir") {
      options.outputDir = argv[++index] ?? "";
    } else if (arg === "--host") {
      options.host = argv[++index] ?? DEFAULT_HOST;
    } else if (arg === "--port") {
      options.port = Number(argv[++index] ?? DEFAULT_PORT);
    } else if (arg === "--project-dir") {
      options.projectDir = resolve(WORKSPACE_ROOT, argv[++index] ?? "");
    } else if (arg === "--skip-build") {
      options.skipBuild = true;
    } else if (arg === "--section-selector") {
      options.sectionSelector = argv[++index] ?? DEFAULT_SECTION_SELECTOR;
    } else if (arg === "--section") {
      options.section.push(argv[++index] ?? "");
    } else if (arg === "--viewport") {
      options.viewport.push(argv[++index] ?? "");
    } else if (arg === "--variant") {
      options.variant = argv[++index] ?? "";
    } else if (arg === "--no-pdf") {
      options.includePdf = false;
    } else if (arg === "--wait-ms") {
      options.waitMs = Number(argv[++index] ?? 600);
    } else if (arg === "--help") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function printHelp() {
  console.log(`Usage: web-visual-feedback-capture [options]

Generic mode:
  --base-url <url>         URL to capture
  --server-command <cmd>   Optional shell command to start a local server
  --ready-url <url>        Health/readiness URL when using --server-command
  --working-dir <path>     Working directory for --server-command
  --section-selector <sel> Section locator used to discover capture targets

Convenience mode:
  --project-dir <path>     Build and preview a Vite app with pnpm (default: current directory)
  --skip-build             Skip "pnpm build" before previewing the local project

Shared options:
  --url <url>              Alias for --base-url
  --output-dir <path>      Output directory (default: artifacts/web-visual-feedback/<timestamp>)
  --variant <name>         Append a before/after/custom variant directory
  --host <host>            Preview host in convenience mode
  --port <port>            Preview port in convenience mode
  --section <name>         Restrict capture to named section ids; repeatable
  --viewport <name>        Restrict capture to desktop|tablet|mobile; repeatable
  --no-pdf                 Skip PDF generation
  --wait-ms <ms>           Settling delay after load/scroll (default: 600)
`);
}

function timestamp() {
  return new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
}

function selectViewports(requestedNames) {
  if (requestedNames.length === 0) {
    return DEFAULT_VIEWPORTS;
  }

  const selected = DEFAULT_VIEWPORTS.filter((viewport) =>
    requestedNames.includes(viewport.name),
  );
  if (selected.length === 0) {
    throw new Error(
      `No supported viewports selected: ${requestedNames.join(", ")}`,
    );
  }

  return selected;
}

async function runCommand(command, args, cwd) {
  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd,
      stdio: "inherit",
      env: process.env,
    });

    child.on("error", rejectPromise);
    child.on("exit", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }

      rejectPromise(
        new Error(
          `${command} ${args.join(" ")} exited with code ${code ?? "unknown"}`,
        ),
      );
    });
  });
}

function spawnManagedCommand(command, cwd) {
  return spawn(command, {
    cwd,
    shell: true,
    stdio: "inherit",
    env: process.env,
  });
}

async function waitForUrl(url, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { method: "GET" });
      if (response.ok) {
        return;
      }
      lastError = new Error(`Unexpected status: ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }

  throw new Error(
    `Timed out waiting for ${url}: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

async function startProjectPreview(projectDir, host, port, skipBuild) {
  const baseUrl = `http://${host}:${port}`;

  if (!skipBuild) {
    await runCommand("pnpm", ["build"], projectDir);
  }

  const child = spawnManagedCommand(
    `pnpm exec vite preview --host ${host} --port ${port} --strictPort`,
    projectDir,
  );
  await waitForUrl(baseUrl);

  return {
    child,
    baseUrl,
    readyUrl: baseUrl,
    mode: "project-dir",
  };
}

async function startManagedServer(serverCommand, cwd, readyUrl, baseUrl) {
  const child = spawnManagedCommand(serverCommand, cwd);
  const probeUrl = readyUrl || baseUrl;
  if (!probeUrl) {
    throw new Error(
      "When using --server-command, provide --ready-url or --base-url",
    );
  }

  await waitForUrl(probeUrl);

  return {
    child,
    baseUrl,
    readyUrl: probeUrl,
    mode: "server-command",
  };
}

async function stopManagedChild(child) {
  if (!child || child.killed) {
    return;
  }

  child.kill("SIGTERM");
  await new Promise((resolvePromise) => {
    child.once("exit", () => resolvePromise());
    setTimeout(() => {
      if (!child.killed) {
        child.kill("SIGKILL");
      }
      resolvePromise();
    }, 3_000);
  });
}

async function stabilizePage(page, waitMs) {
  await page.addStyleTag({
    content: `
      *,
      *::before,
      *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition-duration: 0s !important;
        transition-delay: 0s !important;
        scroll-behavior: auto !important;
      }

      .reveal {
        opacity: 1 !important;
        transform: none !important;
      }
    `,
  });

  await page.evaluate(async () => {
    const step = Math.max(400, Math.floor(window.innerHeight * 0.8));
    const max = Math.max(
      document.body.scrollHeight,
      document.documentElement.scrollHeight,
    );

    for (let offset = 0; offset < max; offset += step) {
      window.scrollTo(0, offset);
      await new Promise((resolvePromise) =>
        window.setTimeout(resolvePromise, 50),
      );
    }

    window.scrollTo(0, 0);
  });

  await page.waitForTimeout(waitMs);
}

async function collectSections(page, sectionSelector) {
  return page.locator(sectionSelector).evaluateAll((elements) =>
    elements.map((element, index) => {
      const rawName =
        element.getAttribute("data-section") ??
        element.id ??
        element.getAttribute("aria-label") ??
        `section-${index + 1}`;
      const name = rawName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
      const heading =
        element
          .querySelector("h1, h2, h3")
          ?.textContent?.replace(/\s+/g, " ")
          .trim() ?? rawName;
      const paddedIndex = String(index + 1).padStart(2, "0");

      return {
        index: index + 1,
        paddedIndex,
        name,
        dirName: `${paddedIndex}-${name}`,
        heading,
        selector:
          element.getAttribute("data-section") != null
            ? `[data-section="${element.getAttribute("data-section")}"]`
            : element.id
              ? `#${element.id}`
              : sectionSelector,
      };
    }),
  );
}

function pageArtifactPath(outputDir, viewportName) {
  return resolve(outputDir, "pages", viewportName, "00-full.png");
}

function pdfArtifactPath(outputDir, viewportName) {
  return resolve(outputDir, "pdf", viewportName, "page.pdf");
}

function sectionArtifactPath(outputDir, sectionDirName, viewportName) {
  return resolve(outputDir, "sections", sectionDirName, `${viewportName}.png`);
}

async function captureViewportArtifacts(
  browser,
  baseUrl,
  viewportConfig,
  outputDir,
  sectionSelector,
  requestedSections,
  includePdf,
  waitMs,
) {
  const context = await browser.newContext({
    ...devices[viewportConfig.device],
    colorScheme: "light",
  });
  const page = await context.newPage();

  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await stabilizePage(page, waitMs);

  const availableSections = await collectSections(page, sectionSelector);
  const sections =
    requestedSections.length === 0
      ? availableSections
      : availableSections.filter((section) =>
          requestedSections.includes(section.name),
        );

  const fullPagePath = pageArtifactPath(outputDir, viewportConfig.name);
  await mkdir(dirname(fullPagePath), { recursive: true });
  await page.screenshot({
    path: fullPagePath,
    fullPage: true,
  });

  const sectionArtifacts = [];
  for (const section of sections) {
    const locator = page.locator(section.selector).first();
    await locator.scrollIntoViewIfNeeded();
    await page.waitForTimeout(waitMs);

    const sectionPath = sectionArtifactPath(
      outputDir,
      section.dirName,
      viewportConfig.name,
    );
    await mkdir(dirname(sectionPath), { recursive: true });
    await locator.screenshot({
      path: sectionPath,
    });

    sectionArtifacts.push({
      ...section,
      path: sectionPath,
    });
  }

  let pdfPath = "";
  if (includePdf && viewportConfig.name === "desktop") {
    pdfPath = pdfArtifactPath(outputDir, viewportConfig.name);
    await mkdir(dirname(pdfPath), { recursive: true });
    await page.pdf({
      path: pdfPath,
      format: "A4",
      printBackground: true,
      margin: {
        top: "12mm",
        right: "12mm",
        bottom: "12mm",
        left: "12mm",
      },
    });
  }

  await context.close();

  return {
    viewport: viewportConfig.name,
    device: viewportConfig.device,
    fullPagePath,
    pdfPath,
    sections: sectionArtifacts,
  };
}

function resolveBaseUrl(options) {
  return (
    options.baseUrl ||
    options.url ||
    (options.serverCommand ? "" : `http://${options.host}:${options.port}`)
  );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const baseUrl = resolveBaseUrl(options);
  const outputRoot = options.outputDir
    ? resolve(WORKSPACE_ROOT, options.outputDir)
    : resolve(DEFAULT_OUTPUT_ROOT, timestamp());
  const outputDir = options.variant
    ? resolve(outputRoot, options.variant)
    : outputRoot;

  await mkdir(outputDir, { recursive: true });

  let managedServer = null;
  let effectiveBaseUrl = baseUrl;
  if (options.serverCommand) {
    managedServer = await startManagedServer(
      options.serverCommand,
      options.workingDir,
      options.readyUrl,
      baseUrl,
    );
    effectiveBaseUrl = managedServer.baseUrl;
  } else if (!options.baseUrl && !options.url) {
    managedServer = await startProjectPreview(
      options.projectDir,
      options.host,
      options.port,
      options.skipBuild,
    );
    effectiveBaseUrl = managedServer.baseUrl;
  }

  if (!effectiveBaseUrl) {
    throw new Error(
      "Provide --base-url/--url, or use --server-command, or rely on --project-dir mode",
    );
  }

  const browser = await chromium.launch({ headless: true });

  try {
    const artifacts = [];
    const selectedViewports = selectViewports(options.viewport);

    for (const viewport of selectedViewports) {
      const result = await captureViewportArtifacts(
        browser,
        effectiveBaseUrl,
        viewport,
        outputDir,
        options.sectionSelector,
        options.section.filter(Boolean),
        options.includePdf,
        options.waitMs,
      );
      artifacts.push(result);
    }

    const manifestPath = resolve(outputDir, "manifest.json");
    const manifest = {
      generatedAt: new Date().toISOString(),
      variant: options.variant || null,
      baseUrl: effectiveBaseUrl,
      readyUrl: options.readyUrl || managedServer?.readyUrl || effectiveBaseUrl,
      sectionSelector: options.sectionSelector,
      mode: managedServer?.mode ?? "base-url",
      launch: managedServer
        ? managedServer.mode === "project-dir"
          ? {
              projectDir: options.projectDir,
              host: options.host,
              port: options.port,
              skipBuild: options.skipBuild,
            }
          : {
              serverCommand: options.serverCommand,
              workingDir: options.workingDir,
            }
        : null,
      artifacts,
    };
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

    console.log(`Artifacts written to ${outputDir}`);
    console.log(`Manifest: ${manifestPath}`);
  } finally {
    await browser.close();
    await stopManagedChild(managedServer?.child);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
