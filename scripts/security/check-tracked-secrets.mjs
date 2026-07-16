import {
  lstatSync,
  readFileSync,
  readlinkSync,
} from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repositoryHint = fileURLToPath(new URL("../../", import.meta.url));

function runGit(args) {
  const result = spawnSync("git", args, {
    cwd: repositoryHint,
    encoding: null,
    maxBuffer: 256 * 1024 * 1024,
    windowsHide: true,
  });

  if (result.error) {
    throw new Error(`unable to run git: ${result.error.message}`);
  }

  if (result.status !== 0) {
    throw new Error(`git ${args[0]} failed with exit code ${result.status}`);
  }

  return result.stdout;
}

const repositoryRoot = runGit(["rev-parse", "--show-toplevel"])
  .toString("utf8")
  .trim();

const dangerousFilenameRules = [
  {
    id: "ENV_FILE",
    matches: (path, name) =>
      name === ".env" || name.startsWith(".env.") || name === ".envrc",
  },
  {
    id: "DEV_VARS_FILE",
    matches: (_path, name) =>
      name === ".dev.vars" || name.startsWith(".dev.vars."),
  },
  {
    id: "REGISTRY_AUTH_FILE",
    matches: (_path, name) =>
      name === ".npmrc" || name === ".pypirc",
  },
  {
    id: "CREDENTIAL_FILE",
    matches: (_path, name) =>
      name === ".netrc" ||
      name === "auth.json" ||
      /^credentials\.(?:json|ya?ml)$/.test(name) ||
      /^service[-_]account.*\.json$/.test(name) ||
      /^firebase-adminsdk.*\.json$/.test(name),
  },
  {
    id: "SECRET_FILE",
    matches: (_path, name) =>
      /^secrets?\.(?:json|ya?ml)$/.test(name),
  },
  {
    id: "PRIVATE_KEY_FILE",
    matches: (_path, name) =>
      /\.(?:pem|key|p12|pfx|jks|keystore|kdbx)$/.test(name) ||
      /^(?:id_rsa|id_dsa|id_ecdsa|id_ed25519)$/.test(name),
  },
];

const privateKeyBlockPattern = new RegExp(
  ["-----BEGIN", "(?: [A-Z0-9][A-Z0-9 -]{0,48})? PRIVATE KEY-----"].join(""),
  "g",
);
const pgpPrivateKeyBlockPattern = new RegExp(
  ["-----BEGIN PGP", " PRIVATE KEY BLOCK-----"].join(""),
  "g",
);

const contentRules = [
  { id: "PRIVATE_KEY_BLOCK", pattern: privateKeyBlockPattern },
  { id: "PGP_PRIVATE_KEY_BLOCK", pattern: pgpPrivateKeyBlockPattern },
  { id: "AWS_ACCESS_KEY_ID", pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  {
    id: "AWS_SECRET_ACCESS_KEY",
    pattern: /\baws_secret_access_key\s*[:=]\s*["']?[A-Za-z0-9/+]{40}["']?/gi,
  },
  { id: "GITHUB_TOKEN", pattern: /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/g },
  { id: "GITHUB_FINE_GRAINED_TOKEN", pattern: /\bgithub_pat_[A-Za-z0-9_]{82,255}\b/g },
  { id: "GITLAB_TOKEN", pattern: /\bglpat-[A-Za-z0-9_-]{20,}\b/g },
  { id: "NPM_TOKEN", pattern: /\bnpm_[A-Za-z0-9]{36}\b/g },
  { id: "PYPI_TOKEN", pattern: /\bpypi-AgEIcH[A-Za-z0-9_-]{50,}\b/g },
  {
    id: "OPENAI_API_KEY",
    pattern: /\bsk-(?:(?:proj|svcacct)-[A-Za-z0-9_-]{40,}|[A-Za-z0-9]{48})\b/g,
  },
  {
    id: "ANTHROPIC_API_KEY",
    pattern: /\bsk-ant-api\d{2}-[A-Za-z0-9_-]{40,}\b/g,
  },
  { id: "GOOGLE_API_KEY", pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { id: "GOOGLE_OAUTH_CLIENT_SECRET", pattern: /\bGOCSPX-[0-9A-Za-z_-]{20,}\b/g },
  { id: "SLACK_TOKEN", pattern: /\bxox[baprs]-[0-9A-Za-z-]{20,}\b/g },
  {
    id: "SLACK_WEBHOOK",
    pattern: /https:\/\/hooks\.slack\.com\/services\/[A-Z0-9]{8,}\/[A-Z0-9]{8,}\/[A-Za-z0-9]{20,}/g,
  },
  { id: "STRIPE_LIVE_KEY", pattern: /\b(?:sk|rk)_live_[0-9A-Za-z]{16,}\b/g },
  {
    id: "SENDGRID_API_KEY",
    pattern: /\bSG\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g,
  },
  { id: "HUGGING_FACE_TOKEN", pattern: /\bhf_[A-Za-z0-9]{30,}\b/g },
  {
    id: "AZURE_STORAGE_CONNECTION_STRING",
    pattern: /\bDefaultEndpointsProtocol=https;AccountName=[^;\s]+;AccountKey=[A-Za-z0-9+/]{80,}={0,2}(?:;[^\r\n]*)?/g,
  },
  {
    id: "BEARER_TOKEN",
    pattern: /\bAuthorization["']?\s*[:=]\s*["']?Bearer\s+[A-Za-z0-9._~+/-]{24,}/gi,
  },
];

function trackedPaths() {
  const output = runGit(["ls-files", "--cached", "-z"]);
  return output
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .map((path) => path.replaceAll("\\", "/"));
}

function readIndexFile(path) {
  // Scan the exact blob that the next commit would contain. Reading only the
  // working tree can miss a secret that remains staged after a local cleanup.
  return runGit(["show", `:${path}`]);
}

function readWorkingTreeFile(path) {
  const absolutePath = resolve(repositoryRoot, ...path.split("/"));

  try {
    const stat = lstatSync(absolutePath);
    if (stat.isSymbolicLink()) {
      return Buffer.from(readlinkSync(absolutePath), "utf8");
    }
    if (!stat.isFile()) {
      return null;
    }
    return readFileSync(absolutePath);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
    return null;
  }
}

function decodeText(buffer) {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.subarray(2).toString("utf16le");
  }

  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
  if (sample.includes(0)) {
    return null;
  }

  let controlBytes = 0;
  for (const byte of sample) {
    if (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d) {
      controlBytes += 1;
    }
  }

  if (sample.length > 0 && controlBytes / sample.length > 0.2) {
    return null;
  }

  return buffer.toString("utf8").replace(/^\uFEFF/, "");
}

function lineNumberAt(text, offset) {
  let line = 1;
  for (let index = 0; index < offset; index += 1) {
    if (text.charCodeAt(index) === 0x0a) {
      line += 1;
    }
  }
  return line;
}

function scan() {
  const findings = [];
  const paths = trackedPaths();

  for (const path of paths) {
    const normalizedPath = path.toLowerCase();
    const name = normalizedPath.slice(normalizedPath.lastIndexOf("/") + 1);

    for (const rule of dangerousFilenameRules) {
      if (rule.matches(normalizedPath, name)) {
        findings.push({ rule: rule.id, path, line: 1 });
      }
    }

    const buffers = [readIndexFile(path)];
    const workingTreeBuffer = readWorkingTreeFile(path);
    if (
      workingTreeBuffer !== null &&
      !buffers.some((buffer) => buffer.equals(workingTreeBuffer))
    ) {
      buffers.push(workingTreeBuffer);
    }

    for (const buffer of buffers) {
      const text = decodeText(buffer);
      if (text === null) {
        continue;
      }

      for (const rule of contentRules) {
        rule.pattern.lastIndex = 0;
        for (const match of text.matchAll(rule.pattern)) {
          findings.push({
            rule: rule.id,
            path,
            line: lineNumberAt(text, match.index),
          });
        }
      }
    }
  }

  const uniqueFindings = [...new Map(
    findings.map((finding) => [
      `${finding.rule}\0${finding.path}\0${finding.line}`,
      finding,
    ]),
  ).values()].sort((left, right) =>
    left.path.localeCompare(right.path) ||
    left.line - right.line ||
    left.rule.localeCompare(right.rule),
  );

  if (uniqueFindings.length === 0) {
    console.log(
      `Tracked secret scan: PASS (${paths.length} index path(s) plus working-tree variants scanned)`,
    );
    return 0;
  }

  console.error(`Tracked secret scan: FAIL (${uniqueFindings.length} finding(s))`);
  for (const finding of uniqueFindings) {
    console.error(`[${finding.rule}] ${JSON.stringify(finding.path)}:${finding.line}`);
  }
  return 1;
}

try {
  process.exitCode = scan();
} catch (error) {
  console.error(`Tracked secret scan: ERROR (${error.message})`);
  process.exitCode = 2;
}
