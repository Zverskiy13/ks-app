# -*- coding: utf-8 -*-
"""
Распознавание голоса (speech-to-text). Два провайдера, выбор через STT_PROVIDER:
  • openai  — OpenAI Whisper (модель whisper-1). Тянет длинные записи. Нужен OPENAI_API_KEY.
  • yandex  — Yandex SpeechKit (короткое распознавание, ≤30 сек / ≤1 МБ).
             Нативно ест OggOpus из Telegram. Нужен YANDEX_API_KEY (+ YANDEX_FOLDER_ID).
Telegram голосовые приходят в формате OggOpus (.oga) — оба провайдера его понимают.
"""
import os
import requests

PROVIDER = os.environ.get("STT_PROVIDER", "openai").lower()


def transcribe(audio_bytes):
    if PROVIDER == "yandex":
        return _yandex(audio_bytes)
    return _openai(audio_bytes)


def _openai(audio_bytes):
    key = os.environ["OPENAI_API_KEY"]
    r = requests.post(
        "https://api.openai.com/v1/audio/transcriptions",
        headers={"Authorization": f"Bearer {key}"},
        files={"file": ("voice.oga", audio_bytes, "audio/ogg")},
        data={"model": "whisper-1", "language": "ru"},
        timeout=120,
    )
    r.raise_for_status()
    return r.json().get("text", "").strip()


def tts(text):
    """Текст → голос (Ogg/Opus) через OpenAI TTS. Нужен OPENAI_API_KEY."""
    key = os.environ["OPENAI_API_KEY"]
    r = requests.post(
        "https://api.openai.com/v1/audio/speech",
        headers={"Authorization": f"Bearer {key}"},
        json={"model": os.environ.get("TTS_MODEL", "tts-1"),
              "voice": os.environ.get("TTS_VOICE", "onyx"),
              "input": text[:1500],
              "response_format": "opus"},
        timeout=120,
    )
    r.raise_for_status()
    return r.content


def _yandex(audio_bytes):
    key = os.environ["YANDEX_API_KEY"]
    folder = os.environ.get("YANDEX_FOLDER_ID", "")
    params = {"lang": "ru-RU", "topic": "general"}
    if folder:
        params["folderId"] = folder
    r = requests.post(
        "https://stt.api.cloud.yandex.net/speech/v1/stt:recognize",
        headers={"Authorization": f"Api-Key {key}"},
        params=params,
        data=audio_bytes,
        timeout=120,
    )
    r.raise_for_status()
    return r.json().get("result", "").strip()
