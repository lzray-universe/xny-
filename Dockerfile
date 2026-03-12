FROM python:3.11-slim-bookworm

ENV DEBIAN_FRONTEND=noninteractive

RUN set -eux; \
    if [ -f /etc/apt/sources.list.d/debian.sources ]; then \
      sed -i 's|http://deb.debian.org/debian|http://mirrors.cloud.aliyuncs.com/debian|g; s|https://deb.debian.org/debian|http://mirrors.cloud.aliyuncs.com/debian|g; s|http://security.debian.org/debian-security|http://mirrors.cloud.aliyuncs.com/debian-security|g; s|https://security.debian.org/debian-security|http://mirrors.cloud.aliyuncs.com/debian-security|g' /etc/apt/sources.list.d/debian.sources; \
    fi; \
    if [ -f /etc/apt/sources.list ]; then \
      sed -i 's|http://deb.debian.org/debian|http://mirrors.cloud.aliyuncs.com/debian|g; s|https://deb.debian.org/debian|http://mirrors.cloud.aliyuncs.com/debian|g; s|http://security.debian.org/debian-security|http://mirrors.cloud.aliyuncs.com/debian-security|g; s|https://security.debian.org/debian-security|http://mirrors.cloud.aliyuncs.com/debian-security|g' /etc/apt/sources.list; \
    fi; \
    apt-get update; \
    apt-get install -y --no-install-recommends wkhtmltopdf fonts-noto-cjk; \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir --timeout 120 -i https://mirrors.tuna.tsinghua.edu.cn/pypi/web/simple -r requirements.txt
COPY . .

ENV WKHTMLTOPDF_PATH=/usr/bin/wkhtmltopdf
ENV PYTHONUNBUFFERED=1
ENV PORT=7860

CMD gunicorn -w 2 -k gthread --threads 8 -t 120 -b 0.0.0.0:$PORT proxy:app
