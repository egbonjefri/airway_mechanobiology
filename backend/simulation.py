import numpy as np

class Spring:
    def __init__(self, mass1_idx, mass2_idx, rest_length, k):
        self.m1 = mass1_idx
        self.m2 = mass2_idx
        self.rest_length = rest_length
        self.k = k

class ASMCell:
    def __init__(self, mass_idx, orientation):
        self.mass_idx = mass_idx
        self.orientation = orientation  # Unit vector along cell axis (circumferential)
        self.force_strength = 1.0
        self.active = True

class CylindricalAirway:
    """
    - Cylindrical geometry (airway cross-section)
    - Verlet integration (stable)
    - Diagonal springs (shear resistance)
    - Orientation-dependent cell forces
    """
    def __init__(self, num_radial=8, num_circum=24, inner_radius=1.0, outer_radius=2.0,
                 mass=1.0, damping=0.8, stiffness=50.0, cell_force=2.0):
        self.num_radial = num_radial
        self.num_circum = num_circum
        self.num_masses = num_radial * num_circum
        
        self.inner_radius = inner_radius
        self.outer_radius = outer_radius
        self.mass = mass
        self.damping = damping
        self.stiffness = stiffness
        self.cell_force = cell_force
        
        # Initialize positions in cylindrical grid
        self.positions = np.zeros((self.num_masses, 2))
        self.prev_positions = np.zeros((self.num_masses, 2))
        
        for r in range(num_radial):
            radius = inner_radius + (outer_radius - inner_radius) * (r / (num_radial - 1))
            for c in range(num_circum):
                angle = 2 * np.pi * c / num_circum
                idx = r * num_circum + c
                self.positions[idx] = np.array([radius * np.cos(angle), radius * np.sin(angle)])
                self.prev_positions[idx] = self.positions[idx].copy()
        
        # Create springs: circumferential, radial, and diagonal
        self.springs = []
        for r in range(num_radial):
            for c in range(num_circum):
                idx = r * num_circum + c
                
                # Circumferential spring
                next_c = (c + 1) % num_circum
                idx_next_c = r * num_circum + next_c
                rest = np.linalg.norm(self.positions[idx_next_c] - self.positions[idx])
                self.springs.append(Spring(idx, idx_next_c, rest, stiffness))
                
                # Radial spring
                if r < num_radial - 1:
                    idx_next_r = (r + 1) * num_circum + c
                    rest = np.linalg.norm(self.positions[idx_next_r] - self.positions[idx])
                    self.springs.append(Spring(idx, idx_next_r, rest, stiffness))
                    
                    # Diagonal springs (shear resistance)
                    idx_diag1 = (r + 1) * num_circum + next_c
                    rest = np.linalg.norm(self.positions[idx_diag1] - self.positions[idx])
                    self.springs.append(Spring(idx, idx_diag1, rest, stiffness * 0.5))
                    
                    prev_c = (c - 1 + num_circum) % num_circum
                    idx_diag2 = (r + 1) * num_circum + prev_c
                    rest = np.linalg.norm(self.positions[idx_diag2] - self.positions[idx])
                    self.springs.append(Spring(idx, idx_diag2, rest, stiffness * 0.5))
        
        # Create ASM cells in middle layer(s)
        self.cells = []
        mid_layer = num_radial // 2
        for c in range(num_circum):
            idx = mid_layer * num_circum + c
            next_c = (c + 1) % num_circum
            idx_next = mid_layer * num_circum + next_c
            
            # Cell orientation: tangent to circle (circumferential)
            tangent = self.positions[idx_next] - self.positions[idx]
            tangent /= np.linalg.norm(tangent)
            
            cell = ASMCell(idx, tangent)
            cell.force_strength = cell_force
            self.cells.append(cell)
        
        # Fix outer layer (tethered to surrounding tissue)
        self.fixed = set()
        for c in range(num_circum):
            self.fixed.add((num_radial - 1) * num_circum + c)
        
        # Store initial area for constriction calculation
        self.initial_area = self.compute_inner_area()
    
    def compute_inner_area(self):
        """Compute area enclosed by innermost ring using shoelace formula"""
        area = 0.0
        for c in range(self.num_circum):
            next_c = (c + 1) % self.num_circum
            p1 = self.positions[c]
            p2 = self.positions[next_c]
            area += p1[0] * p2[1] - p2[0] * p1[1]
        return abs(area) / 2.0
    
    def step_verlet(self, dt=0.01, substeps=5):
        """
        Verlet integration with multiple substeps for stability.
        More stable than Euler for stiff spring systems.
        """
        sub_dt = dt / substeps
        
        for _ in range(substeps):
            # Store current positions
            current = self.positions.copy()
            
            # Verlet integration: x_new = 2*x - x_prev + a*dt^2
            # With damping: x_new = x + (x - x_prev) * damping + a*dt^2
            velocities = (current - self.prev_positions) / sub_dt
            new_positions = current + velocities * sub_dt * self.damping
            
            # Compute accelerations from forces
            forces = np.zeros_like(self.positions)
            
            # Spring forces
            for spring in self.springs:
                p1, p2 = self.positions[spring.m1], self.positions[spring.m2]
                vec = p2 - p1
                dist = np.linalg.norm(vec)
                if dist < 1e-6:
                    continue
                
                force_mag = spring.k * (dist - spring.rest_length)
                force_dir = vec / dist
                
                forces[spring.m1] += force_mag * force_dir
                forces[spring.m2] -= force_mag * force_dir
            
            # Cell contractile forces (orientation-dependent)
            for cell in self.cells:
                if not cell.active:
                    continue
                
                # Update cell orientation based on current geometry
                r = cell.mass_idx // self.num_circum
                c = cell.mass_idx % self.num_circum
                next_c = (c + 1) % self.num_circum
                idx_next = r * self.num_circum + next_c
                
                tangent = self.positions[idx_next] - self.positions[cell.mass_idx]
                tangent_norm = np.linalg.norm(tangent)
                if tangent_norm > 1e-6:
                    tangent /= tangent_norm
                    cell.orientation = tangent
                
                # Apply contractile force along cell orientation
                # This shortens the circumference
                forces[cell.mass_idx] += cell.force_strength * cell.orientation
                forces[idx_next] -= cell.force_strength * cell.orientation
            
            # Update positions with acceleration
            accelerations = forces / self.mass
            new_positions += accelerations * (sub_dt ** 2)
            
            # Enforce fixed boundary conditions
            for idx in self.fixed:
                new_positions[idx] = current[idx]
            
            # Update for next iteration
            self.prev_positions = current
            self.positions = new_positions
    
    def simulate(self, steps=1000, dt=0.01, save_interval=10):
        """
        Run simulation and return trajectory data for frontend.
        
        Returns:
            positions_over_time: List of position arrays at saved intervals
            constriction_over_time: List of constriction percentages
        """
        positions_over_time = []
        constriction_over_time = []
        
        for step in range(steps):
            self.step_verlet(dt=dt)
            
            if step % save_interval == 0:
                positions_over_time.append(self.positions.tolist())
                
                current_area = self.compute_inner_area()
                constriction = (self.initial_area - current_area) / self.initial_area * 100
                constriction_over_time.append(constriction)
        
        return positions_over_time, constriction_over_time


# Example usage
if __name__ == "__main__":
    # Create airway model
    airway = CylindricalAirway(
        num_radial=8,
        num_circum=24,
        inner_radius=1.0,
        outer_radius=2.0,
        mass=1.0,
        damping=0.8,
        stiffness=50.0,
        cell_force=2.0
    )
    
    # Run simulation
    positions, constriction = airway.simulate(steps=1000, dt=0.01, save_interval=10)
    
    print(f"Initial area: {airway.initial_area:.3f}")
    print(f"Final constriction: {constriction[-1]:.1f}%")
    print(f"Frames saved: {len(positions)}")