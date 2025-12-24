# Use official Python runtime as a parent image
FROM python:3.11-slim

# Install system dependencies including ffmpeg and poppler for PDF tools
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg git poppler-utils libreoffice fonts-liberation qpdf libgl1 libglib2.0-0 libgomp1 ca-certificates && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Set the working directory in the container
WORKDIR /app

# Copy the requirements file into the container
COPY requirements.txt .

# Install any needed packages specified in requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the application code
COPY . .

# Expose the default Render port (10000)
EXPOSE 10000

# Allow overriding the port via environment
ENV PORT=10000

# Run gunicorn and bind to $PORT provided by Render
CMD ["sh", "-c", "gunicorn app:app --bind 0.0.0.0:${PORT} --workers 2 --timeout 120"]
