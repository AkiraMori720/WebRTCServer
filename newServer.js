const express = require("express");
const http = require("http");
const app = express();
const server = http.createServer(app);
const socket = require("socket.io");
const io = socket(server);
let rooms = {};
let users = {};

const ROOM_ID_LENGTH = 6;

io.on('connection', function(socket){
    // User login
    socket.on('user-login', function(userId){
        let newUsers = users;

        // userId is unique identifier
        if(newUsers[userId]){
            return;
        }

        newUsers[userId] = {socketId: socket.id, muted: false};
        users = {...newUsers};

        console.log('user-login', userId, users, rooms);
        let userList = Object.keys(users).map(id => ({userId: id}));
        let roomList = Object.keys(rooms).map(rid => ({room_id: rid, room_pass: rooms[rid].password}));
        io.sockets.emit("list", userList, roomList);

        Object.keys(rooms).forEach(rid => {
            rooms[rid].users.forEach( userSocketId => {
                // Partners
                let partnerUserIds = Object.keys(users).filter(user_id => !rooms[rid].users.includes(users[user_id].socketId));
                let partners = partnerUserIds.map(user_id => ({ userId: user_id, socketId: users[user_id].socketId}));

                io.to(userSocketId).emit('partner_list', rid, partners);
            })
        });
    });

    // User logout
    socket.on('user-logout', function(userId){
        if(users[userId]){
            delete users[userId];
        }

        console.log('user-logout', userId, users, rooms);
        let userList = Object.keys(users).map(id => ({userId: id}));
        let roomList = Object.keys(rooms).map(rid => ({room_id: rid, room_pass: rooms[rid].password}));
        io.sockets.emit("list", userList, roomList);
    });

    // User Calling
    socket.on('call', function(userId, receiverId){
        let receiverSocketId = users[receiverId].socketId;
        io.to(receiverSocketId).emit("user-call", userId, socket.id);
        console.log('user-call', receiverSocketId);
    })

    // Terminate calling
    socket.on('stop-call', function(uid){
        if(users[uid]){
            io.to(users[uid].socketId).emit("stop-call");
        }
    })

    // User receive call
    socket.on('receive', function(uid, cuid, room){
        console.log('Create Room', uid, cuid, room);
        let rId = room.room_id;
        rooms[rId] = {users: [users[uid].socketId, users[cuid].socketId], password: room.room_pass};

        // add room
        let roomList = Object.keys(rooms).map(rid => ({room_id: rid, room_pass: rooms[rid].password}));
        io.sockets.emit("room-list", roomList);
        let roomUsers = [{userId: uid, socketId: users[uid].socketId, muted: users[uid].muted}, {userId: cuid, socketId: users[cuid].socketId, muted: users[uid].muted}];

        // Partners
        let partnerUserIds = Object.keys(users).filter(user_id => !rooms[rId].users.includes(users[user_id].socketId));
        let partners = partnerUserIds.map(user_id => ({ userId: user_id, socketId: users[user_id].socketId}));

        io.to(users[cuid].socketId).emit("user-joined", room, socket.id, roomUsers, partners??[]);
        console.log('user-joined', users[cuid].socketId);
        io.to(users[uid].socketId).emit("user-joined", room, socket.id, roomUsers, partners??[]);
        console.log('user-joined', users[uid].socketId);
    })

    socket.on('user-muted', function(rid, uid, muted){
        console.log('User Muted', uid, muted);
        if(rooms[rid] && rooms[rid].users){
            users[uid].muted = muted;
            let userSockets = rooms[rid].users;
            let roomUsers = userSockets.map(socketId => {
                let userId = Object.keys(users).find(userId => users[userId].socketId === socketId);
                return {userId: userId, socketId: socketId, muted: users[userId].muted};
            });
            rooms[rid].users.forEach(socketId => {
                io.to(socketId).emit("room-users", rid, roomUsers);
            });
        }
    })

    // User reject call
    socket.on('reject', function(uid, cuid){
        console.log('reject', uid, cuid);
        let callSocketId = users[cuid].socketId;
        io.to(callSocketId).emit("user-reject", uid);
    })

    // User join into room
    socket.on("join", (roomID, userId) => {
        console.log("join", io.sockets.clients().sockets);
        if(rooms[roomID] && rooms[roomID].users){

            // Full Room
            if(rooms[roomID].users.length > 3){
                io.to(socket.id).emit('full-room');
                return;
            }
            let roomData = rooms[roomID];
            roomData.users.push(socket.id);
            rooms[roomID] = {...roomData};
        } else {
            let roomData = rooms[roomID];
            roomData.users = [socket.id];
            rooms[roomID] = {...roomData};
        }

        const room = { room_id: roomID, room_pass: rooms[roomID].password}

        // Room Users
        let userSockets = rooms[roomID].users;
        let roomUsers = userSockets.map(socketId => {
            let userId = Object.keys(users).find(userId => users[userId].socketId === socketId);
            return {userId: userId, socketId: socketId};
        });

        // Partners
        let partnerUserIds = Object.keys(users).filter(user_id => !userSockets.includes(users[user_id].socketId));
        let partners = partnerUserIds.map(user_id => ({ userId: user_id, socketId: users[user_id].socketId}));

        rooms[roomID].users.forEach(socketId => {
            io.to(socketId).emit("user-joined", room, socket.id, roomUsers, partners??[]);
        });
    })

    socket.on('signal', (toId, message) => {
        io.to(toId).emit('signal', socket.id, message);
    });

    socket.on("message", function(data){
        io.sockets.emit("broadcast-message", socket.id, data);
    });

    socket.on("invite", function(roomId, fromUserId, toUserId){
        if(users[toUserId] && rooms[roomId]){
            let invite_room = { room_id: roomId, room_pass: rooms[roomId].password};
            io.to(users[toUserId].socketId).emit('invite', invite_room, fromUserId)
        }
    });

    socket.on('leave', function(roomID) {
        if(rooms[roomID] && rooms[roomID].users){
            let roomData = rooms[roomID];
            roomData.users = roomData.users.filter(sid => sid !== socket.id);
            rooms[roomID] = {...roomData};
        }

        io.sockets.emit("user-left", roomID, socket.id);

        Object.keys(rooms).forEach(rid => {
            rooms[rid].users.forEach( userSocketId => {
                // Partners
                let partnerUserIds = Object.keys(users).filter(user_id => !rooms[rid].users.includes(users[user_id].socketId));
                let partners = partnerUserIds.map(user_id => ({ userId: user_id, socketId: users[user_id].socketId}));

                io.to(userSocketId).emit('partner_list', rid, partners);
            })
        });
    })

    socket.on('user-leave', function(roomId){
        console.log('user-leave', roomId, rooms[roomId]);
        if(rooms[roomId] && rooms[roomId].users){
            let otherSockets = rooms[roomId].users.filter(sid => sid !== socket.id);
            if(otherSockets.length){

                let partnerUserIds = Object.keys(users).filter(user_id => !otherSockets.includes(users[user_id].socketId));
                let partners = partnerUserIds.map(user_id => ({ userId: user_id, socketId: users[user_id].socketId}));

                otherSockets.forEach((socketId) => {
                    io.to(socketId).emit("user-left", roomId, socket.id);
                })
                let roomData = rooms[roomId];
                roomData.users = otherSockets;
                rooms[roomId] = {...roomData};
            } else {
                delete rooms[roomId];
                // delete room
                let roomList = Object.keys(rooms).map(rid => ({room_id: rid, room_pass: rooms[rid].password}));
                io.sockets.emit("room-list", roomList);
            }

            Object.keys(rooms).forEach(rid => {
                rooms[rid].users.forEach( userSocketId => {
                    // Partners
                    let partnerUserIds = Object.keys(users).filter(user_id => !rooms[rid].users.includes(users[user_id].socketId));
                    let partners = partnerUserIds.map(user_id => ({ userId: user_id, socketId: users[user_id].socketId}));

                    io.to(userSocketId).emit('partner_list', rid, partners);
                })
            });
        }
    });

    socket.on('disconnect', function() {
        let leaveUserId = Object.keys(users).find(id => users[id].socketId === socket.id );
        if(leaveUserId){
            delete users[leaveUserId];
            let userRoomId = Object.keys(rooms).find(rid => rooms[rid].users.includes(socket.id));
            console.log('disconnect', leaveUserId, users, rooms);
            if(userRoomId){
                let newRoom = rooms;
                newRoom[userRoomId].users = newRoom[userRoomId].users.filter(socketId => socketId !== socket.id);
                rooms[userRoomId] = {...newRoom[userRoomId]};

                if(rooms[userRoomId].length){
                    rooms[userRoomId].users.forEach(socketId => {
                        io.to(socketId).emit("user-left", userRoomId,  socket.id);
                    });
                } else {
                    delete rooms[userRoomId];
                }
            }
            let userList = Object.keys(users).map(id => ({userId: id}));
            let roomList = Object.keys(rooms).map(rid => ({room_id: rid, room_pass: rooms[rid].password}));
            io.sockets.emit("list", userList, roomList);

            Object.keys(rooms).forEach(rid => {
                rooms[rid].users.forEach( userSocketId => {
                    // Partners
                    let partnerUserIds = Object.keys(users).filter(user_id => !rooms[rid].users.includes(users[user_id].socketId));
                    let partners = partnerUserIds.map(user_id => ({ userId: user_id, socketId: users[user_id].socketId}));

                    io.to(userSocketId).emit('partner_list', rid, partners);
                })
            });
        }
    });
});

server.listen(3000, function(){
    console.log("Server listening on port %d in %s mode", 3000, app.settings.env);
});
