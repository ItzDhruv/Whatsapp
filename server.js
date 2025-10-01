const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors'); 
const app = express();
const server = http.createServer(app);

const io = socketIo(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static('uploads'));
app.use(express.static('public')); // Serve static files from 'public' directory

// Create necessary directories
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');x
}
if (!fs.existsSync('public')) {
  fs.mkdirSync('public');
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (mimetype && extname) {
      return cb(null, true);
    }
    cb(new Error('Only image files are allowed!'));
  }
});

// MongoDB connection
mongoose.connect('mongodb://localhost:27017/chatapp', {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('✓ MongoDB connected successfully'))
.catch(err => console.error('✗ MongoDB connection error:', err));

// ==================== SCHEMAS ====================

// User Schema
const userSchema = new mongoose.Schema({
  username: { 
    type: String, 
    required: true, 
    unique: true,
    trim: true,
    minlength: 3
  },
  email: {
    type: String,
    sparse: true,
    trim: true
  },
  socketId: String,
  online: { 
    type: Boolean, 
    default: false 
  },
  lastSeen: {
    type: Date,
    default: Date.now
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

const User = mongoose.model('User', userSchema);

// Message Schema
const messageSchema = new mongoose.Schema({
  sender: { 
    type: String, 
    required: true 
  },
  receiver: {
    type: String,
    default: null
  },
  groupId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Group',
    default: null
  },
  content: {
    type: String,
    default: ''
  },
  photo: {
    type: String,
    default: null
  },
  type: { 
    type: String, 
    enum: ['private', 'group'], 
    required: true 
  },
  read: {
    type: Boolean,
    default: false
  },
  timestamp: { 
    type: Date, 
    default: Date.now 
  }
});

messageSchema.index({ sender: 1, receiver: 1, timestamp: -1 });
messageSchema.index({ groupId: 1, timestamp: -1 });

const Message = mongoose.model('Message', messageSchema);

// Group Schema
const groupSchema = new mongoose.Schema({
  name: { 
    type: String, 
    required: true,
    trim: true
  },
  description: {
    type: String,
    default: ''
  },
  admin: {
    type: String,
    required: true
  },
  members: [{
    type: String,
    required: true
  }],
  createdAt: { 
    type: Date, 
    default: Date.now 
  }
});

const Group = mongoose.model('Group', groupSchema);

// ==================== REST API ENDPOINTS ====================

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    success: true, 
    message: 'Server is running',
    timestamp: new Date()
  });
});

// Register or login user
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, email } = req.body;
    
    if (!username || username.length < 3) {
      return res.status(400).json({ 
        success: false, 
        error: 'Username must be at least 3 characters' 
      });
    }

    let user = await User.findOne({ username });
    
    if (!user) {
      user = new User({ username, email });
      await user.save();
      console.log(`✓ New user registered: ${username}`);
    } else {
      console.log(`✓ User logged in: ${username}`);
    }
    
    res.json({ 
      success: true, 
      user: {
        _id: user._id,
        username: user.username,
        email: user.email,
        online: user.online,
        createdAt: user.createdAt
      }
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ 
        success: false, 
        error: 'Username already exists' 
      });
    }
    res.status(500).json({ 
      success: false, 
      error: err.message 
    });
  }
});

// Upload photo
app.post('/api/upload', upload.single('photo'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ 
        success: false, 
        error: 'No file uploaded' 
      });
    }
    
    res.json({ 
      success: true, 
      filename: req.file.filename,
      url: `/uploads/${req.file.filename}`,
      size: req.file.size,
      mimetype: req.file.mimetype
    });
  } catch (err) {
    res.status(500).json({ 
      success: false, 
      error: err.message 
    });
  }
});

// Get all users
app.get('/api/users', async (req, res) => {
  try {
    const users = await User.find({}, 'username email online lastSeen createdAt').sort({ username: 1 });
    res.json({ 
      success: true, 
      users,
      count: users.length
    });
  } catch (err) {
    res.status(500).json({ 
      success: false, 
      error: err.message 
    });
  }
});

// Search users by username
app.get('/api/users/search/:query', async (req, res) => {
  try {
    const query = req.params.query;
    const users = await User.find(
      { username: { $regex: query, $options: 'i' } },
      'username email online lastSeen createdAt'
    ).limit(20);
    
    res.json({ 
      success: true, 
      users,
      count: users.length
    });
  } catch (err) {
    res.status(500).json({ 
      success: false, 
      error: err.message 
    });
  }
});

// Get specific user
app.get('/api/users/:username', async (req, res) => {
  try {
    const user = await User.findOne(
      { username: req.params.username }, 
      'username email online lastSeen createdAt'
    );
    
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        error: 'User not found' 
      });
    }
    
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ 
      success: false, 
      error: err.message 
    });
  }
});

// Create group
app.post('/api/groups', async (req, res) => {
  try {
    const { name, description, admin, members } = req.body;
    
    if (!name || !admin) {
      return res.status(400).json({ 
        success: false, 
        error: 'Group name and admin are required' 
      });
    }

    if (!members || !Array.isArray(members) || members.length === 0) {
      return res.status(400).json({ 
        success: false, 
        error: 'At least one member is required' 
      });
    }

    // Ensure admin is in members
    const memberSet = new Set(members);
    memberSet.add(admin);
    
    const group = new Group({ 
      name, 
      description: description || '',
      admin,
      members: Array.from(memberSet)
    });
    
    await group.save();
    console.log(`✓ New group created: ${name} by ${admin}`);
    
    res.json({ 
      success: true, 
      group 
    });
  } catch (err) {
    res.status(500).json({ 
      success: false, 
      error: err.message 
    });
  }
});

// Get all groups
app.get('/api/groups', async (req, res) => {
  try {
    const groups = await Group.find({});
    res.json({ 
      success: true, 
      groups,
      count: groups.length
    });
  } catch (err) {
    res.status(500).json({ 
      success: false, 
      error: err.message 
    });
  }
});

// Get specific group
app.get('/api/groups/:id', async (req, res) => {
  try {
    const group = await Group.findById(req.params.id);
    
    if (!group) {
      return res.status(404).json({ 
        success: false, 
        error: 'Group not found' 
      });
    }
    
    res.json({ success: true, group });
  } catch (err) {
    res.status(500).json({ 
      success: false, 
      error: err.message 
    });
  }
});

// Add member to group
app.post('/api/groups/:id/members', async (req, res) => {
  try {
    const { username } = req.body;
    
    if (!username) {
      return res.status(400).json({ 
        success: false, 
        error: 'Username is required' 
      });
    }

    const group = await Group.findById(req.params.id);
    
    if (!group) {
      return res.status(404).json({ 
        success: false, 
        error: 'Group not found' 
      });
    }

    if (group.members.includes(username)) {
      return res.status(400).json({ 
        success: false, 
        error: 'User already in group' 
      });
    }

    group.members.push(username);
    await group.save();
    
    res.json({ success: true, group });
  } catch (err) {
    res.status(500).json({ 
      success: false, 
      error: err.message 
    });
  }
});

// Remove member from group
app.delete('/api/groups/:id/members/:username', async (req, res) => {
  try {
    const group = await Group.findById(req.params.id);
    
    if (!group) {
      return res.status(404).json({ 
        success: false, 
        error: 'Group not found' 
      });
    }

    if (group.admin === req.params.username) {
      return res.status(400).json({ 
        success: false, 
        error: 'Cannot remove admin from group' 
      });
    }

    group.members = group.members.filter(m => m !== req.params.username);
    await group.save();
    
    res.json({ success: true, group });
  } catch (err) {
    res.status(500).json({ 
      success: false, 
      error: err.message 
    });
  }
});

// Get messages (private or group)
app.get('/api/messages/:type/:id', async (req, res) => {
  try {
    const { type, id } = req.params;
    const { username, limit = 50, skip = 0 } = req.query;
    
    let messages;
    
    if (type === 'private') {
      if (!username) {
        return res.status(400).json({ 
          success: false, 
          error: 'Username required for private messages' 
        });
      }
      
      messages = await Message.find({
        type: 'private',
        $or: [
          { sender: username, receiver: id },
          { sender: id, receiver: username }
        ]
      })
      .sort({ timestamp: -1 })
      .limit(parseInt(limit))
      .skip(parseInt(skip));
    } else if (type === 'group') {
      messages = await Message.find({ 
        type: 'group', 
        groupId: id 
      })
      .sort({ timestamp: -1 })
      .limit(parseInt(limit))
      .skip(parseInt(skip));
    } else {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid message type' 
      });
    }
    
    // Reverse to show oldest first
    messages.reverse();
    
    res.json({ 
      success: true, 
      messages,
      count: messages.length
    });
  } catch (err) {
    res.status(500).json({ 
      success: false, 
      error: err.message 
    });
  }
});

// Get unread message count
app.get('/api/messages/unread/:username', async (req, res) => {
  try {
    const count = await Message.countDocuments({
      receiver: req.params.username,
      read: false,
      type: 'private'
    });
    
    res.json({ 
      success: true, 
      unreadCount: count 
    });
  } catch (err) {
    res.status(500).json({ 
      success: false, 
      error: err.message 
    });
  }
});

// Mark messages as read
app.put('/api/messages/read', async (req, res) => {
  try {
    const { username, sender } = req.body;
    
    await Message.updateMany(
      { 
        receiver: username, 
        sender: sender,
        type: 'private',
        read: false 
      },
      { read: true }
    );
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ 
      success: false, 
      error: err.message 
    });
  }
});

// Delete message
app.delete('/api/messages/:id', async (req, res) => {
  try {
    const message = await Message.findByIdAndDelete(req.params.id);
    
    if (!message) {
      return res.status(404).json({ 
        success: false, 
        error: 'Message not found' 
      });
    }
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ 
      success: false, 
      error: err.message 
    });
  }
});

// ==================== SOCKET.IO EVENTS ====================

const activeUsers = new Map(); // username -> socket.id

io.on('connection', (socket) => {
  console.log(`✓ New client connected: ${socket.id}`);

  // User registration
  socket.on('register', async (username) => {
    try {
      if (!username) {
        socket.emit('error', { message: 'Username is required' });
        return;
      }

      const user = await User.findOneAndUpdate(
        { username },
        { 
          socketId: socket.id, 
          online: true,
          lastSeen: new Date()
        },
        { upsert: true, new: true }
      );

      socket.username = username;
      activeUsers.set(username, socket.id);

      // Notify all clients about user status
      io.emit('user_status', { 
        username, 
        online: true,
        timestamp: new Date()
      });

      console.log(`✓ User registered: ${username} (${socket.id})`);
    } catch (err) {
      console.error('Registration error:', err);
      socket.emit('error', { message: err.message });
    }
  });

  // Private message
  socket.on('private_message', async (data) => {
    try {
      const { receiver, content, photo } = data;

      if (!socket.username) {
        socket.emit('error', { message: 'Not registered' });
        return;
      }

      if (!receiver) {
        socket.emit('error', { message: 'Receiver is required' });
        return;
      }

      if (!content && !photo) {
        socket.emit('error', { message: 'Message content or photo is required' });
        return;
      }

      const message = new Message({
        sender: socket.username,
        receiver,
        content: content || '',
        photo: photo || null,
        type: 'private'
      });

      await message.save();

      // Send to receiver if online
      const receiverUser = await User.findOne({ username: receiver });
      if (receiverUser && receiverUser.online && receiverUser.socketId) {
        io.to(receiverUser.socketId).emit('private_message', {
          _id: message._id,
          sender: socket.username,
          receiver,
          content: message.content,
          photo: message.photo,
          timestamp: message.timestamp
        });
      }

      // Confirm to sender
      socket.emit('message_sent', { 
        success: true, 
        message: {
          _id: message._id,
          sender: socket.username,
          receiver,
          content: message.content,
          photo: message.photo,
          timestamp: message.timestamp
        }
      });

      console.log(`✓ Private message: ${socket.username} -> ${receiver}`);
    } catch (err) {
      console.error('Private message error:', err);
      socket.emit('error', { message: err.message });
    }
  });

  // Group message
  socket.on('group_message', async (data) => {
    try {
      const { groupId, content, photo } = data;

      if (!socket.username) {
        socket.emit('error', { message: 'Not registered' });
        return;
      }

      if (!groupId) {
        socket.emit('error', { message: 'Group ID is required' });
        return;
      }

      if (!content && !photo) {
        socket.emit('error', { message: 'Message content or photo is required' });
        return;
      }

      const group = await Group.findById(groupId);
      
      if (!group) {
        socket.emit('error', { message: 'Group not found' });
        return;
      }

      if (!group.members.includes(socket.username)) {
        socket.emit('error', { message: 'You are not a member of this group' });
        return;
      }

      const message = new Message({
        sender: socket.username,
        groupId,
        content: content || '',
        photo: photo || null,
        type: 'group'
      });

      await message.save();

      // Send to all group members
      const messageData = {
        _id: message._id,
        groupId,
        sender: socket.username,
        content: message.content,
        photo: message.photo,
        timestamp: message.timestamp
      };

      for (const member of group.members) {
        const user = await User.findOne({ username: member });
        if (user && user.online && user.socketId) {
          io.to(user.socketId).emit('group_message', messageData);
        }
      }

      console.log(`✓ Group message: ${socket.username} -> Group ${groupId}`);
    } catch (err) {
      console.error('Group message error:', err);
      socket.emit('error', { message: err.message });
    }
  });

  // Join group room
  socket.on('join_group', async (groupId) => {
    try {
      const group = await Group.findById(groupId);
      
      if (!group) {
        socket.emit('error', { message: 'Group not found' });
        return;
      }

      if (!group.members.includes(socket.username)) {
        socket.emit('error', { message: 'You are not a member of this group' });
        return;
      }

      socket.join(groupId);
      console.log(`✓ ${socket.username} joined group ${groupId}`);
    } catch (err) {
      console.error('Join group error:', err);
      socket.emit('error', { message: err.message });
    }
  });

  // Leave group room
  socket.on('leave_group', (groupId) => {
    socket.leave(groupId);
    console.log(`✓ ${socket.username} left group ${groupId}`);
  });

  // Typing indicator for private chat
  socket.on('typing', async (data) => {
    const { receiver } = data;
    const receiverUser = await User.findOne({ username: receiver });
    
    if (receiverUser && receiverUser.online && receiverUser.socketId) {
      io.to(receiverUser.socketId).emit('user_typing', {
        username: socket.username
      });
    }
  });

  // Stop typing indicator
  socket.on('stop_typing', async (data) => {
    const { receiver } = data;
    const receiverUser = await User.findOne({ username: receiver });
    
    if (receiverUser && receiverUser.online && receiverUser.socketId) {
      io.to(receiverUser.socketId).emit('user_stop_typing', {
        username: socket.username
      });
    }
  });

  // Disconnect
  socket.on('disconnect', async () => {
    if (socket.username) {
      try {
        await User.findOneAndUpdate(
          { username: socket.username },
          { 
            online: false,
            lastSeen: new Date()
          }
        );

        activeUsers.delete(socket.username);

        // Notify all clients about user status
        io.emit('user_status', { 
          username: socket.username, 
          online: false,
          lastSeen: new Date()
        });

        console.log(`✓ User disconnected: ${socket.username}`);
      } catch (err) {
        console.error('Disconnect error:', err);
      }
    } else {
      console.log(`✓ Client disconnected: ${socket.id}`);
    }
  });
});

// ==================== SERVER START ====================

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log('='.repeat(50));
  console.log(`✓ Server running on port ${PORT}`);
  console.log(`✓ Socket.io enabled`);
  console.log(`✓ API available at http://localhost:${PORT}/api`);
  console.log(`✓ Frontend available at http://localhost:${PORT}`);
  console.log('='.repeat(50));
});

// Error handling
process.on('unhandledRejection', (err) => {
  console.error('Unhandled Rejection:', err);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  process.exit(1);
});