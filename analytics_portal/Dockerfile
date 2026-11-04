FROM python:3.12-slim
WORKDIR /app
COPY analytics_portal/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY analytics_portal/app.py analytics_portal/index.html ./
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
CMD ["sh", "-c", "exec uvicorn app:app --host 0.0.0.0 --port ${PORT:-10000} --workers 1"]
