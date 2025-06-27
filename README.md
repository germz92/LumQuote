# Photography Services Quote Calculator

A modern, responsive web application for generating photography service quotes with an admin panel for managing services and PDF generation capabilities.

## Features

- **Dynamic Quote Calculator**: Add multiple days with multiple services per day
- **Admin Panel**: Add, edit, and delete services with custom pricing
- **PDF Export**: Generate professional PDF quotes
- **Responsive Design**: Works perfectly on mobile and desktop
- **Real-time Calculations**: Instant quote updates as services are selected
- **MongoDB Integration**: Persistent storage for services and pricing

## Tech Stack

- **Frontend**: HTML5, CSS3, Vanilla JavaScript
- **Backend**: Node.js with Express
- **Database**: MongoDB
- **PDF Generation**: Puppeteer
- **Deployment**: Render

## Installation

### Prerequisites

- Node.js (v18 or higher)
- MongoDB (local installation or MongoDB Atlas)

### Local Development

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd quote-calculator
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   
   Create a `.env` file in the root directory:
   ```env
   MONGODB_URI=mongodb://localhost:27017/quote-calculator
   PORT=3000
   APP_PASSWORD=your-secure-password-here
   SESSION_SECRET=your-random-session-secret-key
   ```

   For MongoDB Atlas, use your connection string:
   ```env
   MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/quote-calculator
   PORT=3000
   APP_PASSWORD=your-secure-password-here
   SESSION_SECRET=your-random-session-secret-key
   ```

   **Important**: 
   - `APP_PASSWORD`: Set this to your desired password for accessing the application
   - `SESSION_SECRET`: Set this to a random string for session security
   - Default password is `admin123` if not specified

4. **Start the application**
   ```bash
   # Development mode with auto-restart
   npm run dev
   
   # Production mode
   npm start
   ```

5. **Access the application**
   - Login: http://localhost:3000/login (or redirected automatically)
   - Main Calculator: http://localhost:3000 (after login)
   - Admin Panel: http://localhost:3000/admin (after login)

## Deployment on Render

This application is configured for easy deployment on Render.

1. **Push your code to GitHub**

2. **Connect to Render**
   - Create a new Web Service on Render
   - Connect your GitHub repository
   - Render will automatically detect the `render.yaml` configuration

3. **Environment Variables**
   - The MongoDB database will be automatically created and connected
   - No manual environment variable setup required

## Security

The application includes password protection for all pages:

- **Login Required**: All pages require authentication
- **Session Management**: Uses secure session cookies (24-hour expiration)
- **Environment-based Password**: Password is configured via environment variables
- **Logout Functionality**: Logout buttons available on all pages
- **Auto-redirect**: Unauthenticated users are redirected to login page

### Password Configuration

Set your password in the `.env` file:
```env
APP_PASSWORD=your-secure-password-here
```

If no password is set, the default is `admin123` (change this for production!).

## Usage

### Authentication

1. **First Visit**: You'll be redirected to the login page
2. **Enter Password**: Use the password configured in your environment
3. **Stay Logged In**: Sessions last 24 hours
4. **Logout**: Use the logout button in the top-right corner

### Main Quote Calculator

1. **Select Number of Days**: Use the +/- buttons to add or remove days
2. **Add Services**: Click "Add Service" for each day to select from available services
3. **Multiple Services**: You can add multiple services per day
4. **Remove Services**: Click the × button on any service tag to remove it
5. **Generate PDF**: Click "Get Final Quote (PDF)" to download a professional quote

### Admin Panel

Access the admin panel at `/admin` to manage your services:

1. **Add New Service**:
   - Enter service name
   - Set price (in dollars)
   - Choose an emoji icon
   - Select category

2. **Edit Service**:
   - Click "Edit" on any service
   - Modify details and click "Update Service"

3. **Delete Service**:
   - Click "Delete" on any service
   - Confirm deletion in the popup

## Default Services

The application comes pre-loaded with these sample services:

- Event Photography - $800
- Event Videography - $1200
- Headshot Booth - $500
- Drone Photography - $400
- Photo Editing - $300

## API Endpoints

### Services

- `GET /api/services` - Get all services
- `POST /api/services` - Create a new service
- `PUT /api/services/:id` - Update a service
- `DELETE /api/services/:id` - Delete a service

### PDF Generation

- `POST /api/generate-pdf` - Generate and download PDF quote

## File Structure

```
quote-calculator/
├── public/
│   ├── index.html          # Main quote calculator page
│   ├── admin.html          # Admin panel page
│   ├── styles.css          # All CSS styles
│   ├── script.js           # Quote calculator JavaScript
│   └── admin.js            # Admin panel JavaScript
├── server.js               # Express server and API routes
├── package.json            # Dependencies and scripts
├── render.yaml             # Render deployment configuration
├── .env                    # Environment variables (local)
└── README.md               # This file
```

## Customization

### Styling

All styles are contained in `public/styles.css`. The design uses:
- Modern CSS Grid and Flexbox layouts
- CSS custom properties for easy theming
- Responsive breakpoints for mobile/tablet/desktop
- Smooth animations and transitions

### Services

Services are stored in MongoDB with the following schema:
```javascript
{
  name: String,      // Service name
  price: Number,     // Price in dollars
  icon: String,      // Emoji icon
  category: String,  // Category (photography, videography, editing, other)
  createdAt: Date,
  updatedAt: Date
}
```

### PDF Styling

PDF generation uses Puppeteer to convert HTML to PDF. Customize the PDF template in the `generateQuoteHTML()` function in `server.js`.

## Mobile Responsiveness

The application is fully responsive with:
- Touch-friendly buttons and controls
- Optimized layouts for small screens
- Readable typography at all sizes
- Fast loading and smooth interactions

## Browser Support

- Chrome/Edge 80+
- Firefox 75+
- Safari 13+
- Mobile browsers (iOS Safari, Chrome Mobile)

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

This project is open source and available under the [MIT License](LICENSE).

## Support

For questions or issues:
- Create an issue in the GitHub repository
- Check the browser console for error messages
- Ensure MongoDB is running and accessible

## Future Enhancements

Potential features for future versions:
- User authentication for admin panel
- Email quote delivery
- Quote templates and branding
- Multi-currency support
- Tax calculation options
- Client management system 