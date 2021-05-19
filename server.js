const express = require("express");
const http = require("http");
const app = express();
const server = http.createServer(app);
const socket = require("socket.io");
const io = socket(server);
var rooms = {};
var users = [];

const ROOM_ID_LENGTH = 6;

io.on('connection', function(socket){
    socket.on("join", (roomID) => {
        console.log(io.sockets.clients().sockets);
        if(rooms[roomID]){
            if(rooms[roomID].length > 2){
                io.to(socket.id).emit('full-room');
                return;
            }
            rooms[roomID].push(socket.id);
        } else {
            rooms[roomID] = [socket.id];
        }

        rooms[roomID].forEach(socketId => {
            io.to(socketId).emit("user-joined", roomID, socket.id, rooms[roomID]);
        });
    })

    socket.on('signal', (toId, message) => {
        io.to(toId).emit('signal', socket.id, message);
    });

    socket.on("message", function(data){
        io.sockets.emit("broadcast-message", socket.id, data);
    });

    socket.on('disconnect', function() {
        let leaveUserId = Object.keys(users).find(id => users[id] === socket.id );
        if(leaveUserId){
            delete users[leaveUserId];
        }
        io.sockets.emit("user-left", "",  socket.id);
    })

    socket.on('leave', function(roomID) {
        if(rooms[roomID]){
            rooms[roomID] = rooms[roomID].filter(sid => sid !== socket.id);
        }
        io.sockets.emit("user-left", roomID, socket.id);
    })
    socket.on('single-join', function(userId){
        let newUsers = users;
        newUsers[userId] = socket.id;
        users = {...newUsers};
        let userList = Object.keys(users).map(id => ({userId: id, socketId: users[id]}));
        io.sockets.emit("user-list", userList, rooms);
    })
    socket.on('call', function(userId, socketId){
        let callId = Object.keys(users).find(id => users[id] === socket.id );
        io.to(socketId).emit("user-call", callId, socket.id);
    })
    socket.on('end-call', function(socketId){
        io.to(socketId).emit("end-call");
    })
    socket.on('receive', function(userId, socketId){
        let receivedId = Object.keys(users).find(id => users[id] === socket.id );
        let roomSockets = [socket.id, socketId];
        let rId = makeId(ROOM_ID_LENGTH);
        rooms[rId] = roomSockets;

        // add room
        io.sockets.emit("room-list", rooms);
        io.to(socket.id).emit("user-joined", rId, socket.id, roomSockets);
        io.to(socketId).emit("user-joined", rId, socket.id, roomSockets);
    })
    socket.on('reject', function(userId, socketId){
        let callId = Object.keys(users).find(id => users[id] === socket.id );
        io.to(socketId).emit("user-reject", callId, socket.id);
    })
    socket.on('user-leave', function(roomId){
        console.log('user-leave', roomId, rooms[roomId]);
        if(rooms[roomId]){
            let otherSockets = rooms[roomId].filter(sid => sid !== socket.id);
            if(otherSockets.length){
                otherSockets.forEach((socketId) => {
                    io.to(socketId).emit("user-left", roomId, socket.id);
                })
                rooms[roomId]=otherSockets;
            } else {
                delete rooms[roomId];
                // delete room
                io.sockets.emit("room-list", rooms);
            }
        }
    })
});

function makeId(length) {
    let result = '';
    let characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let charactersLength = characters.length;
    for ( let i = 0; i < length; i++ ) {
        result += characters.charAt(Math.floor(Math.random() * charactersLength));
    }
    return result;
}

server.listen(3000, function(){
    console.log("Server listening on port %d in %s mode", 3000, app.settings.env);
});
