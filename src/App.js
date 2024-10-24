import React, { useState, useCallback, useRef, useEffect } from 'react';
import axios from 'axios';
import debounce from 'lodash/debounce';
import Quagga from 'quagga';
import './App.css';

const API_KEY = process.env.REACT_APP_API_KEY;

function App() {
  const [foodItems, setFoodItems] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isScanning, setIsScanning] = useState(false);
  const scannerRef = useRef(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);

  const searchFood = async (query) => {
    if (!query) {
      setSearchResults([]);
      return;
    }
    try {
      const response = await axios.get(
        `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${API_KEY}&query=${query}&pageSize=5`
      );
      setSearchResults(response.data.foods);
    } catch (error) {
      console.error('Error searching for food:', error);
    }
  };

  // Debounce the search function to limit API calls
  const debouncedSearch = useCallback(
    debounce((query) => searchFood(query), 300),
    []
  );

  const handleSearchChange = (e) => {
    setSearchTerm(e.target.value);
    debouncedSearch(e.target.value);
  };

  const addFoodItem = (item) => {
    const calories = item.foodNutrients.find(n => n.nutrientName === 'Energy')?.value || 0;
    const protein = item.foodNutrients.find(n => n.nutrientName === 'Protein')?.value || 0;
    const carbs = item.foodNutrients.find(n => n.nutrientName === 'Carbohydrate, by difference')?.value || 0;
    const fat = item.foodNutrients.find(n => n.nutrientName === 'Total lipid (fat)')?.value || 0;

    setFoodItems([...foodItems, { 
      name: item.description,
      calories,
      protein,
      carbs,
      fat,
      servings: 1 
    }]);

    // Clear the search bar and results
    setSearchTerm('');
    setSearchResults([]);
  };

  const updateServings = (index, newServings) => {
    const updatedFoodItems = foodItems.map((item, i) => {
      if (i === index) {
        return { ...item, servings: newServings };
      }
      return item;
    });
    setFoodItems(updatedFoodItems);
  };

  const deleteFoodItem = (index) => {
    const updatedFoodItems = foodItems.filter((_, i) => i !== index);
    setFoodItems(updatedFoodItems);
  };

  const calculateTotals = () => {
    return foodItems.reduce((acc, item) => {
      acc.calories += item.calories * item.servings;
      acc.protein += item.protein * item.servings;
      acc.carbs += item.carbs * item.servings;
      acc.fat += item.fat * item.servings;
      return acc;
    }, { calories: 0, protein: 0, carbs: 0, fat: 0 });
  };

  const calculateMacroPercentages = () => {
    const totals = calculateTotals();
    const totalMacros = totals.protein + totals.carbs + totals.fat;
    if (totalMacros === 0) {
      return { protein: 0, carbs: 0, fat: 0 };
    }
    return {
      protein: (totals.protein / totalMacros) * 100,
      carbs: (totals.carbs / totalMacros) * 100,
      fat: (totals.fat / totalMacros) * 100,
    };
  };

  const macroPercentages = calculateMacroPercentages();
  const hasMacros = Object.values(macroPercentages).some(value => value > 0);

  const startScanning = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
      setIsScanning(true);
    } catch (err) {
      console.error("Error accessing the camera", err);
      alert("Unable to access the camera. Please make sure you've granted the necessary permissions.");
    }
  };

  const stopScanning = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const tracks = videoRef.current.srcObject.getTracks();
      tracks.forEach(track => track.stop());
    }
    setIsScanning(false);
  };

  const handleBarcodeScan = useCallback(async (result) => {
    stopScanning();
    const barcode = result.codeResult.code;
    try {
      const response = await axios.get(
        `https://world.openfoodfacts.org/api/v0/product/${barcode}.json`
      );
      if (response.data.status === 1) {
        const product = response.data.product;
        addFoodItem({
          description: product.product_name,
          foodNutrients: [
            { nutrientName: 'Energy', value: product.nutriments.energy_100g },
            { nutrientName: 'Protein', value: product.nutriments.proteins_100g },
            { nutrientName: 'Carbohydrate, by difference', value: product.nutriments.carbohydrates_100g },
            { nutrientName: 'Total lipid (fat)', value: product.nutriments.fat_100g },
          ],
        });
      } else {
        alert('Product not found');
      }
    } catch (error) {
      console.error('Error fetching product data:', error);
      alert('Error fetching product data');
    }
  }, [addFoodItem]);

  const captureImage = useCallback(() => {
    if (videoRef.current && canvasRef.current) {
      const canvas = canvasRef.current;
      const video = videoRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
      
      // Here you would typically send this image to a barcode scanning service
      // For now, we'll just stop scanning and log a message
      console.log("Image captured. In a real app, this would be sent for barcode processing.");
      stopScanning();
    }
  }, []);

  useEffect(() => {
    if (isScanning) {
      Quagga.init(
        {
          inputStream: {
            type: 'LiveStream',
            constraints: {
              width: 480,
              height: 320,
              facingMode: 'environment',
            },
            target: scannerRef.current,
          },
          locator: {
            patchSize: 'medium',
            halfSample: true,
          },
          numOfWorkers: 2,
          decoder: {
            readers: ['ean_reader'],
          },
          locate: true,
        },
        function (err) {
          if (err) {
            console.log(err);
            return;
          }
          Quagga.start();
        }
      );

      Quagga.onDetected(handleBarcodeScan);

      return () => {
        Quagga.offDetected(handleBarcodeScan);
        Quagga.stop();
      };
    }
  }, [isScanning, handleBarcodeScan]);

  return (
    <div className="App">
      <h1>Calorie Logger</h1>
      
      <div className="food-input">
        <div className="food-search">
          <input
            type="text"
            value={searchTerm}
            onChange={handleSearchChange}
            placeholder="Search for a food item"
          />
        </div>
        <button onClick={isScanning ? stopScanning : startScanning} className="scan-btn">
          {isScanning ? 'Stop Scanning' : 'Scan Barcode'}
        </button>
      </div>

      {isScanning && (
        <div ref={scannerRef} className="scanner-container">
          <video ref={videoRef} className="scanner-video" />
        </div>
      )}

      <div className="food-list">
        <h2>Food Items</h2>
        <ul>
          {foodItems.map((item, index) => (
            <li key={index}>
              <div className="food-item-info">
                <span className="food-item-name">{item.name}</span>
                <span className="food-item-calories">{(item.calories * item.servings).toFixed(2)} calories</span>
              </div>
              <div className="food-item-controls">
                <input
                  type="number"
                  min="0.25"
                  step="0.25"
                  value={item.servings}
                  onChange={(e) => updateServings(index, parseFloat(e.target.value))}
                  className="serving-input"
                />
                <span className="serving-label">servings</span>
                <button onClick={() => deleteFoodItem(index)} className="delete-btn">Delete</button>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="totals">
        <h2>Totals</h2>
        <p>Calories: {calculateTotals().calories.toFixed(2)}</p>
        <p>Protein: {calculateTotals().protein.toFixed(2)}g</p>
        <p>Carbs: {calculateTotals().carbs.toFixed(2)}g</p>
        <p>Fat: {calculateTotals().fat.toFixed(2)}g</p>

        <h3>Macro Percentages</h3>
        {hasMacros ? (
          <div className="macro-chart">
            {Object.entries(macroPercentages).map(([macro, percentage]) => (
              <div key={macro} className="macro-bar" style={{width: `${percentage}%`}}>
                <span className="macro-label">{macro}</span>
                <span className="macro-percentage">{percentage.toFixed(1)}%</span>
              </div>
            ))}
          </div>
        ) : (
          <p>No macros to display</p>
        )}
      </div>
    </div>
  );
}

export default App;
