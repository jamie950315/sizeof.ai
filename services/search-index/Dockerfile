FROM python:3.12-slim
WORKDIR /app
COPY src /app/src
ENV PYTHONUNBUFFERED=1
EXPOSE 8788
CMD ["python", "-m", "src.server"]
