const express = require('express');
const userController = require('../controllers/user.controller');

const userRouter = express.Router();

// Route to get user by ID
userRouter.get('/', userController.getUserById);

module.exports = userRouter;