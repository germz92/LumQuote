const bcrypt = require('bcrypt');
const readline = require('readline');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

async function generateHash() {
    rl.question('Enter the password you want to hash: ', async (password) => {
        if (!password) {
            console.log('Password cannot be empty');
            rl.close();
            return;
        }
        
        try {
            const saltRounds = 10;
            const hash = await bcrypt.hash(password, saltRounds);
            
            console.log('\n=== PASSWORD HASH GENERATED ===');
            console.log('Add this to your .env file:');
            console.log(`ADMIN_PASSWORD_HASH=${hash}`);
            console.log('\nFor additional security, also add:');
            console.log(`SESSION_SECRET=${require('crypto').randomBytes(32).toString('hex')}`);
            console.log('\n=== IMPORTANT ===');
            console.log('1. Add these to your .env file');
            console.log('2. Remove or comment out any ADMIN_PASSWORD entry');
            console.log('3. Keep your .env file secure and never commit it to version control');
            
        } catch (error) {
            console.error('Error generating hash:', error);
        }
        
        rl.close();
    });
}

generateHash(); 