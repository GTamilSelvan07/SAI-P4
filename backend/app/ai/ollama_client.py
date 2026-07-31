"""
Async Ollama client for LLM generation.
"""
import time
import asyncio
import logging
from typing import Optional
from dataclasses import dataclass

import httpx

from app.config import config

log = logging.getLogger(__name__)


@dataclass
class LLMResponse:
    text: str
    model: str
    latency_ms: int
    tokens: int


class OllamaClient:
    """Async client for Ollama API at localhost:11434."""

    def __init__(self):
        self._base_url = config.ollama.base_url
        self._model = config.ollama.model
        self._timeout = config.ollama.timeout_seconds
        self._client: Optional[httpx.AsyncClient] = None

    async def start(self) -> None:
        if self._client:
            await self._client.aclose()
        self._client = httpx.AsyncClient(timeout=httpx.Timeout(self._timeout + 2))

    async def stop(self) -> None:
        if self._client:
            await self._client.aclose()
            self._client = None

    async def generate(
        self,
        system_prompt: str,
        user_prompt: str,
        model: Optional[str] = None,
        temperature: float = 0.7,
        max_tokens: int = 200,
    ) -> Optional[LLMResponse]:
        """
        Generate a response from Ollama.
        Returns None on timeout or error.
        """
        if not self._client:
            await self.start()

        model = model or self._model
        t0 = time.time()

        try:
            resp = await self._client.post(
                f"{self._base_url}/api/generate",
                json={
                    "model": model,
                    "system": system_prompt,
                    "prompt": user_prompt,
                    "stream": False,
                    "think": False,  # Disable thinking/CoT for real-time responses
                    "options": {
                        "temperature": temperature,
                        "num_predict": max_tokens,
                        "num_gpu": config.ollama.num_gpu,
                    },
                },
                timeout=self._timeout,
            )
            resp.raise_for_status()
            data = resp.json()
            latency_ms = int((time.time() - t0) * 1000)

            text = data.get("response", "").strip()
            tokens = data.get("eval_count", 0)

            return LLMResponse(
                text=text,
                model=model,
                latency_ms=latency_ms,
                tokens=tokens,
            )

        except httpx.TimeoutException:
            log.warning(f"[Ollama] generate() timed out after {self._timeout}s (model={model})")
            return None
        except httpx.HTTPStatusError as e:
            log.error(f"[Ollama] generate() HTTP error: {e.response.status_code} {e.response.text[:200]}")
            return None
        except Exception as e:
            log.error(f"[Ollama] generate() unexpected error: {type(e).__name__}: {e}")
            return None

    async def chat(
        self,
        messages: list[dict],
        model: Optional[str] = None,
        temperature: float = 0.7,
        max_tokens: int = 200,
    ) -> Optional[LLMResponse]:
        """
        Chat-style generation with message history.
        """
        if not self._client:
            await self.start()

        model = model or self._model
        t0 = time.time()

        try:
            resp = await self._client.post(
                f"{self._base_url}/api/chat",
                json={
                    "model": model,
                    "messages": messages,
                    "stream": False,
                    "think": False,  # Disable thinking/CoT — need direct responses for real-time facilitation
                    "options": {
                        "temperature": temperature,
                        "num_predict": max_tokens,
                        "num_gpu": config.ollama.num_gpu,
                    },
                },
                timeout=self._timeout,
            )
            resp.raise_for_status()
            data = resp.json()
            latency_ms = int((time.time() - t0) * 1000)

            text = data.get("message", {}).get("content", "").strip()
            tokens = data.get("eval_count", 0)

            return LLMResponse(
                text=text,
                model=model,
                latency_ms=latency_ms,
                tokens=tokens,
            )

        except httpx.TimeoutException:
            log.warning(f"[Ollama] chat() timed out after {self._timeout}s (model={model})")
            return None
        except httpx.HTTPStatusError as e:
            log.error(f"[Ollama] chat() HTTP error: {e.response.status_code} {e.response.text[:200]}")
            return None
        except Exception as e:
            log.error(f"[Ollama] chat() unexpected error: {type(e).__name__}: {e}")
            return None

    async def is_available(self) -> bool:
        """Check if Ollama is running and model is loaded."""
        try:
            if not self._client:
                await self.start()
            resp = await self._client.get(f"{self._base_url}/api/tags", timeout=3)
            if resp.status_code == 200:
                models = [m.get("name", "") for m in resp.json().get("models", [])]
                log.info(f"[Ollama] Available at {self._base_url}, models: {models}")
                if not any(self._model in m for m in models):
                    log.warning(f"[Ollama] Model '{self._model}' not found in loaded models: {models}")
                return True
            log.warning(f"[Ollama] Unexpected status {resp.status_code} from /api/tags")
            return False
        except Exception as e:
            log.error(f"[Ollama] Not available at {self._base_url}: {type(e).__name__}: {e}")
            return False


# Global client
ollama = OllamaClient()
