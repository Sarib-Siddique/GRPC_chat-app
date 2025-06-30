# Use Node base image
FROM node:18


# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the app
COPY . .

# Expose app port
EXPOSE 3000

# Run the app
CMD ["node", "index.js"]
