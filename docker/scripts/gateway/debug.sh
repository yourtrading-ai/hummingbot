#!/bin/bash

echo
echo
echo "===============  CREATE A NEW HUMMINGBOT GATEWAY INSTANCE ==============="
echo
echo
echo "ℹ️  Press [ENTER] for default values:"
echo

ssh-add ~/.ssh/companion
git pull
docker stop temp-hb-gateway
docker rm temp-hb-gateway
docker rmi temp-hb-gateway
docker commit hummingbot-gateway temp-hb-gateway

CUSTOMIZE=$1

if [ "$CUSTOMIZE" == "--customize" ]
then
  # Specify hummingbot image
  RESPONSE="$IMAGE_NAME"
  if [ "$RESPONSE" == "" ]
  then
    read -p "   Enter Hummingbot image you want to use (default = \"hummingbot-gateway\") >>> " RESPONSE
  fi
  if [ "$RESPONSE" == "" ]
  then
   IMAGE_NAME="hummingbot-gateway"
  fi

  # Specify hummingbot version
  RESPONSE="$TAG"
  if [ "$RESPONSE" == "" ]
  then
    read -p "   Enter Hummingbot version you want to use [latest/development] (default = \"latest\") >>> " RESPONSE
  fi
  if [ "$RESPONSE" == "" ]
  then
   TAG="latest"
  else
    TAG=$RESPONSE
  fi

  # Ask the user if it want to create a new docker image of gateway
  RESPONSE="$BUILD_CACHE"
  if [ "$RESPONSE" == "" ]
  then
    read -p "   Do you want to use an existing Hummingbot Gateway image (\"y/N\") >>> " RESPONSE
  fi
  if [[ "$RESPONSE" == "N" || "$RESPONSE" == "n" || "$RESPONSE" == "" ]]
  then
    echo "   A new image will be created..."
    BUILD_CACHE="--no-cache"
  else
    BUILD_CACHE=""
  fi

  # Ask the user for the name of the new gateway instance
  RESPONSE="$INSTANCE_NAME"
  if [ "$RESPONSE" == "" ]
  then
    read -p "   Enter a name for your new Hummingbot Gateway instance (default = \"hummingbot-gateway\") >>> " RESPONSE
  fi
  if [ "$RESPONSE" == "" ]
  then
    INSTANCE_NAME="hummingbot-gateway"
  else
    INSTANCE_NAME=$RESPONSE
  fi

  # Ask the user for the folder location to save files
  RESPONSE="$FOLDER"
  if [ "$RESPONSE" == "" ]
  then
    FOLDER_SUFFIX="shared"
    read -p "   Enter a folder path where do you want your Hummingbot Gateway files to be saved (default = \"$FOLDER_SUFFIX\") >>> " RESPONSE
  fi
  if [ "$RESPONSE" == "" ]
  then
    FOLDER=$PWD/$FOLDER_SUFFIX
  elif [[ ${RESPONSE::1} != "/" ]]; then
    FOLDER=$PWD/$RESPONSE
  else
    FOLDER=$RESPONSE
  fi

  # Ask the user for the exposed port of the new gateway instance
  RESPONSE="$PORT"
  if [ "$RESPONSE" == "" ]
  then
    read -p "   Enter a port for expose your new Hummingbot Gateway (default = \"15888\") >>> " RESPONSE
  fi
  if [ "$RESPONSE" == "" ]
  then
    PORT=15888
  else
    PORT=$RESPONSE
  fi

  # Prompts user for a password for gateway certificates
  RESPONSE="$GATEWAY_PASSPHRASE"
  while [ "$RESPONSE" == "" ]
  do
    read -sp "   Define a passphrase for the Gateway certificate  >>> " RESPONSE
    echo "   It is necessary to define a password for the certificate, which is the same as the one entered when executing the \"gateway generate-certs\" command on the client. Try again."
  done
  GATEWAY_PASSPHRASE=$RESPONSE
else
  IMAGE_NAME="temp-hb-gateway"
  TAG="latest"
  BUILD_CACHE="--no-cache"
  INSTANCE_NAME="temp-hb-gateway"
  FOLDER_SUFFIX="shared"
  FOLDER=$PWD/$FOLDER_SUFFIX
  PORT=15888
  ENTRYPOINT="/bin/bash"

  # Prompts user for a password for gateway certificates
  while [ "$GATEWAY_PASSPHRASE" == "" ]
  do
    read -sp "   Define a passphrase for the Gateway certificate  >>> " GATEWAY_PASSPHRASE
    echo "   It is necessary to define a password for the certificate, which is the same as the one entered when executing the \"gateway generate-certs\" command on the client. Try again."
  done
fi

if [ "$DEBUG" == "" ]
then
  ENTRYPOINT="--entrypoint=/bin/bash"
fi

CERTS_FOLDER="$FOLDER/common/certs"
GATEWAY_CONF_FOLDER="$FOLDER/gateway/conf"
GATEWAY_LOGS_FOLDER="$FOLDER/gateway/logs"

echo
echo "ℹ️  Confirm below if the instance and its folders are correct:"
echo
printf "%30s %5s\n" "Instance name:" "$INSTANCE_NAME"
printf "%30s %5s\n" "Version:" "hummingbot/hummingbot:$TAG"
echo
printf "%30s %5s\n" "Main folder path:" "$FOLDER"
printf "%30s %5s\n" "Cert files:" "├── $CERTS_FOLDER"
printf "%30s %5s\n" "Gateway config files:" "└── $GATEWAY_CONF_FOLDER"
printf "%30s %5s\n" "Gateway log files:" "└── $GATEWAY_LOGS_FOLDER"
printf "%30s %5s\n" "Gateway exposed port:" "└── $PORT"
echo

prompt_proceed () {
  RESPONSE=""
  read -p "   Do you want to proceed? [Y/n] >>> " RESPONSE
  if [[ "$RESPONSE" == "Y" || "$RESPONSE" == "y" || "$RESPONSE" == "" ]]
  then
    PROCEED="Y"
  fi
}

# Execute docker commands
create_instance () {
 echo
 echo "Creating Hummingbot instance ..."
 echo
 # 1) Create main folder for your new gateway instance
 mkdir -p $FOLDER
 # 2) Create subfolders for hummingbot files
 mkdir -p $CERTS_FOLDER
 mkdir -p $GATEWAY_CONF_FOLDER
 mkdir -p $GATEWAY_LOGS_FOLDER

 # 3) Set required permissions to save hummingbot password the first time
 chmod a+rw $GATEWAY_CONF_FOLDER

 # 4) Create a new image for gateway
 DOCKER_BUILDKIT=1 docker build $BUILD_CACHE -t $IMAGE_NAME -f docker/scripts/gateway/Dockerfile . && \
 # 5) Launch a new gateway instance of hummingbot
 docker run \
    -it \
    --log-opt max-size=10m \
    --log-opt max-file=5 \
    -p $PORT:15888 \
    --name $INSTANCE_NAME \
    --network host \
    --mount type=bind,source=$CERTS_FOLDER,target=/root/.hummingbot-gateway/certs \
    --mount type=bind,source=$GATEWAY_CONF_FOLDER,target=/root/gateway/conf \
    --mount type=bind,source=$GATEWAY_LOGS_FOLDER,target=/root/gateway/logs \
    --mount type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock \
    -e CERTS_FOLDER="/root/.hummingbot-gateway/certs" \
    -e GATEWAY_CONF_FOLDER="/root/gateway/conf" \
    -e GATEWAY_LOGS_FOLDER="/root/gateway/logs" \
    -e GATEWAY_PASSPHRASE="$GATEWAY_PASSPHRASE" \
    $ENTRYPOINT \
    $IMAGE_NAME:$TAG
}

if [ "$CUSTOMIZE" == "--customize" ]
then
  prompt_proceed
  if [[ "$PROCEED" == "Y" || "$PROCEED" == "y" ]]
  then
   create_instance
  else
   echo "   Aborted"
   echo
  fi
else
  create_instance
fi
