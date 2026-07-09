#!/usr/bin/env python3
from __future__ import annotations

import argparse
import base64
import binascii
import json
import mimetypes
import os
import re
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib import error, request

DEFAULT_API_BASE = "https://aicodelink.top/v1"
DEFAULT_MODEL = "gpt-image-2"
DEFAULT_OUTPUT_DIR = "generated-images"
DEFAULT_ENDPOINT_ORDER = ("generations", "edits")
DEFAULT_ENV_FILE_NAME = ".env"
ENV_KEY_API_BASE = "CUSTOM_IMAGE_API_BASE"
ENV_KEY_API_KEY = "CUSTOM_IMAGE_API_KEY"
ENV_KEY_MODEL = "CUSTOM_IMAGE_MODEL"
ENV_KEY_OUTPUT_DIR = "CUSTOM_IMAGE_OUTPUT_DIR"


@dataclass
class ImagePayload:
    source: str
    data: bytes
    ext: str


class ApiCallError(RuntimeError):
    def __init__(self, endpoint: str, status: int | None, message: str):
        self.endpoint = endpoint
        self.status = status
        self.message = message
        label = f"{endpoint}"
        if status is not None:
            label = f"{label} [{status}]"
        super().__init__(f"{label}: {message}")


class NoImageFoundError(RuntimeError):
    pass


class EnvFileError(RuntimeError):
    pass


class InputFileError(RuntimeError):
    pass


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate images from a text prompt.")
    parser.add_argument("prompt", nargs="+", help="Prompt text used for image generation")
    parser.add_argument("--env-file", default="", help="Path to a .env file")
    parser.add_argument("--api-base", default="")
    parser.add_argument("--api-key", default="")
    parser.add_argument("--model", default="")
    parser.add_argument(
        "--endpoint",
        choices=("auto", "generations", "images", "edits"),
        default="generations",
        help="API style to use",
    )
    parser.add_argument("--image", default="", help="Source image path used for edits")
    parser.add_argument("--output-dir", default="")
    parser.add_argument("--filename-prefix", default="image")
    parser.add_argument("--n", type=int, default=1, help="Requested image count")
    parser.add_argument("--size", default="", help="Optional image size, e.g. 1024x1024")
    parser.add_argument("--background", default="", help="Optional background parameter")
    parser.add_argument(
        "--response-format",
        default="",
        help="Optional response_format, e.g. b64_json（让上游直接回 base64，避免去下载需鉴权的输出图床链接）",
    )
    parser.add_argument("--system", default="", help="Extra system-style instruction")
    parser.add_argument("--timeout", type=int, default=180)
    parser.add_argument("--save-response", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def parse_env_line(line: str) -> tuple[str, str] | None:
    stripped = line.strip()
    if not stripped or stripped.startswith("#"):
        return None
    if stripped.startswith("export "):
        stripped = stripped[7:].strip()
    if "=" not in stripped:
        return None
    key, value = stripped.split("=", 1)
    key = key.strip()
    value = value.strip()
    if not key:
        return None
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
        value = value[1:-1]
    return key, value


def resolve_env_file(explicit_path: str) -> Path | None:
    if explicit_path:
        path = Path(explicit_path).expanduser().resolve()
        if not path.exists():
            raise EnvFileError(f"指定的 .env 文件不存在：{path}")
        return path

    candidates = [
        Path.cwd() / DEFAULT_ENV_FILE_NAME,
        Path(__file__).resolve().parent.parent / DEFAULT_ENV_FILE_NAME,
    ]
    seen: set[Path] = set()
    for path in candidates:
        resolved = path.resolve()
        if resolved in seen:
            continue
        seen.add(resolved)
        if resolved.exists():
            return resolved
    return None


def load_env_values(path: Path | None) -> dict[str, str]:
    if path is None:
        return {}
    values: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        parsed = parse_env_line(raw_line)
        if parsed is None:
            continue
        key, value = parsed
        values[key] = value
    return values


def pick_value(*values: str) -> str:
    for value in values:
        if value:
            return value
    return ""


def apply_config(args: argparse.Namespace) -> argparse.Namespace:
    env_file = resolve_env_file(args.env_file)
    env_values = load_env_values(env_file)

    args.api_base = pick_value(
        args.api_base,
        os.getenv(ENV_KEY_API_BASE, ""),
        env_values.get(ENV_KEY_API_BASE, ""),
        DEFAULT_API_BASE,
    )
    args.api_key = pick_value(
        args.api_key,
        os.getenv(ENV_KEY_API_KEY, ""),
        env_values.get(ENV_KEY_API_KEY, ""),
    )
    args.model = pick_value(
        args.model,
        env_values.get(ENV_KEY_MODEL, ""),
        os.getenv(ENV_KEY_MODEL, ""),
        DEFAULT_MODEL,
    )
    args.output_dir = pick_value(
        args.output_dir,
        env_values.get(ENV_KEY_OUTPUT_DIR, ""),
        os.getenv(ENV_KEY_OUTPUT_DIR, ""),
        DEFAULT_OUTPUT_DIR,
    )
    args.loaded_env_file = str(env_file) if env_file else ""
    return args


def join_prompt(args: argparse.Namespace) -> str:
    prompt = " ".join(part.strip() for part in args.prompt if part.strip()).strip()
    if not prompt:
        raise SystemExit("[ERROR] prompt 不能为空。")
    return prompt


def enrich_prompt(prompt: str, args: argparse.Namespace) -> str:
    extra_lines: list[str] = []
    if args.system:
        extra_lines.append(f"System instruction: {args.system}")
    if args.size:
        extra_lines.append(f"Preferred size: {args.size}")
    if args.background:
        extra_lines.append(f"Preferred background: {args.background}")
    if not extra_lines:
        return prompt
    return f"{prompt}\n\nAdditional requirements:\n" + "\n".join(f"- {line}" for line in extra_lines)


def make_url(api_base: str, endpoint: str) -> str:
    normalized = api_base.rstrip("/")
    mapping = {
        "generations": "/images/generations",
        "images": "/images/generations",
        "edits": "/images/edits",
    }
    return normalized + mapping[endpoint]


# 让上游直接回 base64（response_format=b64_json，部分渠道如 Agnes 还需 return_base64），
# 避免回一个需鉴权的输出图床 URL 导致下载 401。
def apply_response_format(payload: dict[str, Any], response_format: str) -> None:
    if not response_format:
        return
    payload["response_format"] = response_format
    if response_format == "b64_json":
        payload["return_base64"] = True


def build_payload(endpoint: str, prompt: str, args: argparse.Namespace) -> dict[str, Any]:
    if endpoint in {"generations", "images"}:
        payload: dict[str, Any] = {
            "model": args.model,
            "prompt": prompt,
            "n": args.n,
        }
        if args.size:
            payload["size"] = args.size
        if args.background:
            payload["background"] = args.background
        apply_response_format(payload, args.response_format)
        return payload

    # edits 走 multipart，布尔会被编码成字符串 "True" 引起歧义；且当前问题只在文生图(generations)。
    # 如需图生图也回 base64，另行处理 multipart 的布尔编码。
    return {
        "model": args.model,
        "prompt": prompt,
        "n": args.n,
    }


def build_request_preview(endpoint: str, prompt: str, args: argparse.Namespace) -> dict[str, Any]:
    payload = build_payload(endpoint, prompt, args)
    if endpoint == "edits":
        preview = dict(payload)
        preview["image"] = args.image
        return preview
    return payload


def extract_error_message(raw: bytes) -> str:
    text = raw.decode("utf-8", errors="replace").strip()
    if not text:
        return "empty response body"
    try:
        payload = json.loads(text)
    except json.JSONDecodeError:
        return text[:400]

    if isinstance(payload, dict):
        error_value = payload.get("error")
        if isinstance(error_value, dict):
            message = error_value.get("message") or error_value.get("type")
            if isinstance(message, str) and message.strip():
                return message.strip()
        if isinstance(error_value, str) and error_value.strip():
            return error_value.strip()
        message = payload.get("message")
        if isinstance(message, str) and message.strip():
            return message.strip()
    return text[:400]


def post_json(url: str, api_key: str, payload: dict[str, Any], timeout: int) -> dict[str, Any]:
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = request.Request(url, data=body, headers=headers, method="POST")
    try:
        with request.urlopen(req, timeout=timeout) as response:
            raw = response.read()
    except error.HTTPError as exc:
        raise ApiCallError(url, exc.code, extract_error_message(exc.read())) from exc
    except error.URLError as exc:
        raise ApiCallError(url, None, str(exc.reason)) from exc

    try:
        decoded = json.loads(raw.decode("utf-8"))
    except json.JSONDecodeError as exc:
        raise ApiCallError(url, None, "响应不是合法 JSON") from exc
    if not isinstance(decoded, dict):
        raise ApiCallError(url, None, "响应 JSON 不是对象")
    return decoded


def load_upload(path_str: str, label: str) -> tuple[Path, bytes, str]:
    if not path_str:
        raise InputFileError(f"{label} 路径不能为空。")
    path = Path(path_str).expanduser().resolve()
    if not path.exists():
        raise InputFileError(f"{label} 不存在：{path}")
    if not path.is_file():
        raise InputFileError(f"{label} 不是文件：{path}")
    raw = path.read_bytes()
    mime = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    return path, raw, mime


def build_multipart_body(
    fields: dict[str, Any],
    files: list[tuple[str, Path, bytes, str]],
) -> tuple[bytes, str]:
    boundary = f"----ImageBoundary{int(time.time() * 1000)}"
    chunks: list[bytes] = []

    for key, value in fields.items():
        chunks.append(f"--{boundary}\r\n".encode("utf-8"))
        chunks.append(f'Content-Disposition: form-data; name="{key}"\r\n\r\n'.encode("utf-8"))
        chunks.append(f"{value}\r\n".encode("utf-8"))

    for field_name, path, raw, mime in files:
        chunks.append(f"--{boundary}\r\n".encode("utf-8"))
        chunks.append(
            (
                f'Content-Disposition: form-data; name="{field_name}"; '
                f'filename="{path.name}"\r\n'
            ).encode("utf-8")
        )
        chunks.append(f"Content-Type: {mime}\r\n\r\n".encode("utf-8"))
        chunks.append(raw)
        chunks.append(b"\r\n")

    chunks.append(f"--{boundary}--\r\n".encode("utf-8"))
    return b"".join(chunks), f"multipart/form-data; boundary={boundary}"


def post_multipart(
    url: str,
    api_key: str,
    fields: dict[str, Any],
    files: list[tuple[str, Path, bytes, str]],
    timeout: int,
) -> dict[str, Any]:
    body, content_type = build_multipart_body(fields, files)
    headers = {
        "Content-Type": content_type,
        "Accept": "application/json",
    }
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    req = request.Request(url, data=body, headers=headers, method="POST")
    try:
        with request.urlopen(req, timeout=timeout) as response:
            raw = response.read()
    except error.HTTPError as exc:
        raise ApiCallError(url, exc.code, extract_error_message(exc.read())) from exc
    except error.URLError as exc:
        raise ApiCallError(url, None, str(exc.reason)) from exc

    try:
        decoded = json.loads(raw.decode("utf-8"))
    except json.JSONDecodeError as exc:
        raise ApiCallError(url, None, "响应不是合法 JSON") from exc
    if not isinstance(decoded, dict):
        raise ApiCallError(url, None, "响应 JSON 不是对象")
    return decoded


def execute_request(endpoint: str, prompt: str, args: argparse.Namespace) -> dict[str, Any]:
    url = make_url(args.api_base, endpoint)
    payload = build_payload(endpoint, prompt, args)
    if endpoint == "edits":
        image_path, image_data, image_mime = load_upload(args.image, "源图")
        return post_multipart(
            url,
            args.api_key,
            fields=payload,
            files=[("image", image_path, image_data, image_mime)],
            timeout=args.timeout,
        )
    return post_json(url, args.api_key, payload, args.timeout)


def looks_like_image_url(value: Any) -> bool:
    return isinstance(value, str) and value.startswith(("http://", "https://"))


def decode_data_url(value: str) -> ImagePayload | None:
    if not value.startswith("data:image/"):
        return None
    try:
        header, encoded = value.split(",", 1)
    except ValueError:
        return None
    mime = header[5:].split(";", 1)[0].strip().lower()
    ext = mime_to_ext(mime)
    try:
        raw = base64.b64decode(encoded, validate=False)
    except binascii.Error:
        return None
    return ImagePayload(source="base64", data=raw, ext=ext)


def mime_to_ext(mime: str) -> str:
    mapping = {
        "image/png": "png",
        "image/jpeg": "jpg",
        "image/jpg": "jpg",
        "image/webp": "webp",
        "image/gif": "gif",
    }
    return mapping.get(mime, "png")


def infer_ext(raw: bytes) -> str:
    if raw.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if raw.startswith(b"\xff\xd8\xff"):
        return "jpg"
    if raw.startswith(b"RIFF") and raw[8:12] == b"WEBP":
        return "webp"
    if raw.startswith((b"GIF87a", b"GIF89a")):
        return "gif"
    return "png"


def decode_base64_image(value: str) -> ImagePayload | None:
    if len(value) < 64:
        return None
    if value.startswith("data:image/"):
        return decode_data_url(value)
    normalized = "".join(value.split())
    padding = "=" * (-len(normalized) % 4)
    try:
        raw = base64.b64decode(normalized + padding, validate=False)
    except binascii.Error:
        return None
    if len(raw) < 16:
        return None
    ext = infer_ext(raw)
    known = raw.startswith((b"\x89PNG\r\n\x1a\n", b"\xff\xd8\xff", b"GIF87a", b"GIF89a")) or (
        raw.startswith(b"RIFF") and raw[8:12] == b"WEBP"
    )
    if not known:
        return None
    return ImagePayload(source="base64", data=raw, ext=ext)


def extract_inline_images(text: str) -> list[ImagePayload]:
    matches = re.findall(r"data:image/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+", text)
    images: list[ImagePayload] = []
    for match in matches:
        decoded = decode_data_url(match)
        if decoded is not None:
            images.append(decoded)
    return images


def collect_image_candidates(node: Any, images: list[ImagePayload], urls: list[str]) -> None:
    if isinstance(node, dict):
        # 同一个数据项若已带内联图（b64_json 等），就不要再把它的 url 当作第二张：
        # 部分上游会对同一张图同时回 b64_json 和 url，否则会落成重复图、导致多扣费。
        has_inline = False
        for key, value in node.items():
            if key in {"b64_json", "image_base64", "result"} and isinstance(value, str):
                decoded = decode_base64_image(value)
                if decoded is not None:
                    images.append(decoded)
                    has_inline = True
        if not has_inline:
            for key, value in node.items():
                if key in {"url", "image_url"}:
                    if isinstance(value, str) and looks_like_image_url(value):
                        urls.append(value)
                    elif isinstance(value, dict):
                        nested_url = value.get("url")
                        if looks_like_image_url(nested_url):
                            urls.append(nested_url)
        for value in node.values():
            collect_image_candidates(value, images, urls)
        return

    if isinstance(node, list):
        for item in node:
            collect_image_candidates(item, images, urls)
        return

    if isinstance(node, str):
        images.extend(extract_inline_images(node))


def download_image(url: str, api_key: str, timeout: int) -> ImagePayload:
    headers = {"Accept": "image/*, */*"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    req = request.Request(url, headers=headers, method="GET")
    try:
        with request.urlopen(req, timeout=timeout) as response:
            raw = response.read()
            mime = response.headers.get_content_type()
    except error.HTTPError as exc:
        raise ApiCallError(url, exc.code, extract_error_message(exc.read())) from exc
    except error.URLError as exc:
        raise ApiCallError(url, None, str(exc.reason)) from exc

    ext = mime_to_ext(mime) if mime else infer_ext(raw)
    if ext == "png" and mime == "application/octet-stream":
        ext = infer_ext(raw)
    return ImagePayload(source="url", data=raw, ext=ext)


def dedupe_images(images: list[ImagePayload]) -> list[ImagePayload]:
    unique: list[ImagePayload] = []
    seen: set[bytes] = set()
    for image in images:
        signature = image.data[:64]
        if signature in seen:
            continue
        seen.add(signature)
        unique.append(image)
    return unique


def parse_images(response_payload: dict[str, Any], api_key: str, timeout: int) -> list[ImagePayload]:
    images: list[ImagePayload] = []
    urls: list[str] = []
    collect_image_candidates(response_payload, images, urls)
    for url in urls:
        images.append(download_image(url, api_key=api_key, timeout=timeout))
    deduped = dedupe_images(images)
    if not deduped:
        raise NoImageFoundError("响应里没找到图片数据")
    return deduped


def save_response(output_dir: Path, prefix: str, stamp: str, payload: dict[str, Any]) -> Path:
    path = output_dir / f"{prefix}-{stamp}-response.json"
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


def save_images(output_dir: Path, prefix: str, stamp: str, images: list[ImagePayload]) -> list[Path]:
    paths: list[Path] = []
    for index, image in enumerate(images, start=1):
        path = output_dir / f"{prefix}-{stamp}-{index:02d}.{image.ext}"
        path.write_bytes(image.data)
        paths.append(path)
    return paths


def choose_endpoints(mode: str) -> tuple[str, ...]:
    if mode == "auto":
        return DEFAULT_ENDPOINT_ORDER
    if mode == "images":
        return ("generations",)
    return (mode,)


def validate_args(args: argparse.Namespace) -> None:
    if args.endpoint == "edits" and not args.image:
        raise InputFileError("`--endpoint edits` 需要同时传入 `--image`。")


def main() -> int:
    try:
        args = apply_config(parse_args())
    except EnvFileError as exc:
        print(f"[ERROR] {exc}", file=sys.stderr)
        return 2
    try:
        validate_args(args)
    except InputFileError as exc:
        print(f"[ERROR] {exc}", file=sys.stderr)
        return 2

    prompt = join_prompt(args)
    full_prompt = enrich_prompt(prompt, args)
    output_dir = Path(args.output_dir).expanduser().resolve()
    endpoints = choose_endpoints(args.endpoint)

    if args.dry_run:
        preview = {name: build_request_preview(name, full_prompt, args) for name in endpoints}
        print(
            json.dumps(
                {
                    "api_base": args.api_base,
                    "model": args.model,
                    "output_dir": str(output_dir),
                    "loaded_env_file": args.loaded_env_file,
                    "endpoints": preview,
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        return 0

    if not args.api_key:
        print(
            "[ERROR] 未提供 API Key。请在 .env 中设置 CUSTOM_IMAGE_API_KEY，或传入 --api-key。",
            file=sys.stderr,
        )
        return 2

    output_dir.mkdir(parents=True, exist_ok=True)
    errors: list[str] = []

    for endpoint in endpoints:
        try:
            response_payload = execute_request(endpoint, full_prompt, args)
            images = parse_images(response_payload, args.api_key, args.timeout)
        except InputFileError as exc:
            errors.append(f"{endpoint}: {exc}")
            continue
        except NoImageFoundError as exc:
            errors.append(f"{endpoint}: {exc}")
            continue
        except ApiCallError as exc:
            errors.append(str(exc))
            continue

        stamp = time.strftime("%Y%m%d-%H%M%S")
        saved_paths = save_images(output_dir, args.filename_prefix, stamp, images)
        print(f"[OK] endpoint={endpoint} images={len(saved_paths)}")
        for path in saved_paths:
            print(path)
        if args.save_response:
            response_path = save_response(output_dir, args.filename_prefix, stamp, response_payload)
            print(response_path)
        return 0

    print("[ERROR] 所有端点都失败了：", file=sys.stderr)
    for item in errors:
        print(f"- {item}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
