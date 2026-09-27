FROM python:3.11-slim-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    libgomp1 \
 && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir "rembg[cpu]" fastapi uvicorn python-multipart

WORKDIR /app
COPY server.py /app/server.py

EXPOSE 7000

CMD ["python3", "server.py"]
