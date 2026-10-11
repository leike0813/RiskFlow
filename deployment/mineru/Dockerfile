FROM python:3.12.12-slim-bookworm@sha256:2986c55feb36e6cae00fa1fefb454283e4b33f35e75ff8bdd123b134130be301

RUN apt-get update && apt-get install -y --no-install-recommends \
    libvulkan1 libgl1 vulkan-tools fonts-noto-cjk

COPY requirements.txt /opt/mineru/requirements.txt
RUN pip install --no-cache-dir --report /opt/mineru/install-report.json \
    -r /opt/mineru/requirements.txt && pip check && pip freeze > /opt/mineru/installed.txt

RUN apt-get install -y --no-install-recommends libegl1

ENV MINERU_HOME=/var/lib/mineru \
    MINERU_CONFIG=/etc/mineru/config.yaml \
    MINERU_MODEL_SOURCE=local \
    MINERU_MODEL_SMALL_BACKEND=onnx \
    MINERU_MODEL_VLM_ENGINE=llama-cpp \
    MINERU_TABLE_DEVICE=cpu

WORKDIR /var/lib/mineru
ENTRYPOINT ["mineru-kit"]
CMD ["api-server", "--host", "0.0.0.0", "--port", "8000", "--tier", "standard", "--concurrency", "1", "--vlm-max-concurrency", "1", "--preload-models", "--upload-dir", "/var/lib/mineru/uploads", "--log-level", "info"]
