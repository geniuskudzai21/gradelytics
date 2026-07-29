# Gradelytics

Gradelytics is a web application designed to help students track, analyze, and visualize their academic performance. The app allows users to input academic details, view statistics, and celebrate achievements, all in a modern and responsive interface.

## Key Features

- **Module Management** - Add, edit, and delete academic modules with course name, academic year, part, semester, mark, and classification
- **Screenshot Upload & AI Extraction** - Upload a screenshot of your results table and AI will automatically extract all module data using a vision model
- **Dynamic Statistics** - Bar chart showing average marks per part/semester, pie chart showing classification distribution, overall average, and total marks
- **AI Grade Prediction** - Predict your next semester average with AI-powered analysis, identify academic strengths, and get personalized study strategy recommendations
- **Achievement Tracking** - Earn Gold (90+), Silver (80-89), and Bronze (75-79) medals, plus improvement awards for 10+ mark jumps between semesters
- **Gradelytics AI Chat Assistant** - AI-powered chatbot with access to your academic data for personalized analysis, predictions, career recommendations, and study tips. Includes suggested prompts and persistent chat history
- **CSV Export** - Download your academic details as a CSV file
- **Responsive Design** - Mobile-friendly sidebar navigation with hamburger menu toggle
- **Data Persistence** - All modules and chat history stored locally in the browser via localStorage

## Technologies Used

- HTML, CSS (responsive design with CSS custom properties)
- JavaScript (localStorage, Chart.js, chartjs-plugin-datalabels, jsPDF)
- Space Grotesk + Inter fonts (Google Fonts)
- Boxicons (icon library)
- NVIDIA API (AI chat and vision models via backend proxy)
- Vercel Serverless Functions (API proxy for secure key management)

## Purpose

The application empowers students to understand their academic progress and receive AI-driven insights for future improvement and career recommendations.

## Live Demo

https://genius-pa.vercel.app
