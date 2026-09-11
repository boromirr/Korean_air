FROM node:22-bookworm-slim
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl python3 nginx xvfb x11vnc novnc websockify fluxbox fonts-noto-cjk tini \
    && curl -fsSL https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb -o /tmp/chrome.deb \
    && apt-get install -y --no-install-recommends /tmp/chrome.deb \
    && rm -f /tmp/chrome.deb && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
ENV DISPLAY=:99 AWARD_CLOUD_MODE=1 CHROME_DISABLE_SANDBOX=1 AWARD_CONCURRENCY=2 PYTHONUNBUFFERED=1
EXPOSE 8080
ENTRYPOINT ["/usr/bin/tini","--"]
CMD ["python3","cloud/serve.py"]
