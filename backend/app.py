from flask import Flask, jsonify, request
from flask_cors import CORS
from simulation import CylindricalAirway

app = Flask(__name__)
CORS(app)  # Allow cross-origin requests

@app.route('/api/simulate', methods=['POST'])
def simulate():
    """
    Run the airway simulation with parameters from frontend.
    
    Expected JSON body:
    {
        "num_radial": 8,
        "num_circum": 24,
        "inner_radius": 1.0,
        "outer_radius": 2.0,
        "mass": 1.0,
        "damping": 0.8,
        "stiffness": 50.0,
        "cell_force": 2.0,
        "steps": 1000,
        "dt": 0.01,
        "save_interval": 10
    }
    """
    try:
        # Get parameters from request, use defaults if not provided
        params = request.get_json() or {}
        
        # Create airway model with parameters
        airway = CylindricalAirway(
            num_radial=params.get('num_radial', 8),
            num_circum=params.get('num_circum', 24),
            inner_radius=params.get('inner_radius', 1.0),
            outer_radius=params.get('outer_radius', 2.0),
            mass=params.get('mass', 1.0),
            damping=params.get('damping', 0.8),
            stiffness=params.get('stiffness', 50.0),
            cell_force=params.get('cell_force', 2.0)
        )
        
        # Run simulation
        positions, constriction = airway.simulate(
            steps=params.get('steps', 1000),
            dt=params.get('dt', 0.01),
            save_interval=params.get('save_interval', 10)
        )
        
        # Return simulation data
        return jsonify({
            'success': True,
            'data': {
                'positions': positions,
                'constriction': constriction,
                'initial_area': float(airway.initial_area),
                'num_masses': airway.num_masses,
                'num_radial': airway.num_radial,
                'num_circum': airway.num_circum,
                'springs': [
                    {'m1': s.m1, 'm2': s.m2, 'k': s.k, 'rest_length': s.rest_length}
                    for s in airway.springs
                ],
                'cells': [
                    {'mass_idx': c.mass_idx, 'force_strength': c.force_strength}
                    for c in airway.cells
                ],
                'fixed_indices': list(airway.fixed)
            }
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 400

@app.route('/api/parameters', methods=['GET'])
def get_default_parameters():
    """
    Return default simulation parameters for frontend initialization.
    """
    return jsonify({
        'num_radial': 8,
        'num_circum': 24,
        'inner_radius': 1.0,
        'outer_radius': 2.0,
        'mass': 1.0,
        'damping': 0.8,
        'stiffness': 50.0,
        'cell_force': 2.0,
        'steps': 1000,
        'dt': 0.01,
        'save_interval': 10
    })

@app.route('/api/health', methods=['GET'])
def health_check():
    """Simple health check endpoint."""
    return jsonify({'status': 'ok'})

if __name__ == '__main__':
    app.run(debug=True, port=5000)