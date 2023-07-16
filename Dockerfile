FROM node
COPY . .
RUN npm i
CMD npm start

# docker build -t isbn-lookup .