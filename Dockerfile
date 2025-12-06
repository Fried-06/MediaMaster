# Use official Python runtime as a parent image
FROM python:3.11-slim

# Install system dependencies including ffmpeg and poppler for PDF tools
RUN apt-get update && \
    apt-get install -y ffmpeg git poppler-utils && \
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

# Make port 10000 available to the world outside this container (Render default)
EXPOSE 10000

# Define environment variable
ENV PORT=10000

# Run gunicorn when the container launches
CMD ["gunicorn", "app:app", "--bind", "0.0.0.0:10000", "--workers", "2", "--timeout", "120"]
